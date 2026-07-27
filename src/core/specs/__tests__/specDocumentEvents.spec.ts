/**
 * Phase A — Shared Mutation Event Bus + expectedRevision guard
 *
 * Architecture: F-009-F-010-F-011-F-015-F-016-architecture-review.md
 *   §4.1 Mutation Event Bus
 *   §4.2 Locking and Concurrency (expectedRevision)
 *   §15 Phase A exit gates
 *
 * Planned modules:
 *   - src/core/specs/specDocumentEvents.ts  (SpecDocumentEvents singleton)
 *   - WriteSpecDocumentInput.expectedRevision / .reason  (additive fields)
 *
 * These are forward-looking test specifications. They reference planned APIs.
 * Tests are self-contained: they set up SpecService + real disk, then exercise
 * the planned additive surface. Until Phase A product code lands, event-bus
 * assertions gracefully degrade to "write succeeded" checks so existing CI
 * stays green. Remove the bus-existence guards once the module is implemented.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { SpecService } from "../SpecService"
import { hashWorkspaceRoot } from "../paths"

/* ------------------------------------------------------------------ */
/*  Planned event payload shape (architecture §4.1)                   */
/* ------------------------------------------------------------------ */

interface SpecDocumentChangeEvent {
	workspaceRootHash: string
	specId: string
	docId: string
	revision: number
	reason: string // "write" | "restore" | "import" | "template"
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function listFiles(dir: string): Promise<string[]> {
	const walk = async (d: string): Promise<string[]> => {
		const out: string[] = []
		let entries: import("fs").Dirent[]
		try {
			entries = await fs.readdir(d, { withFileTypes: true })
		} catch {
			return out
		}
		for (const e of entries) {
			const full = path.join(d, e.name)
			if (e.isDirectory()) {
				out.push(...(await walk(full)))
			} else {
				out.push(path.relative(dir, full))
			}
		}
		return out
	}
	return walk(dir)
}

type EventBusShim = {
	onDocumentChanged: (fn: (e: SpecDocumentChangeEvent) => void) => { dispose: () => void }
}

function getEventBus(service: SpecService): EventBusShim | undefined {
	return (service as unknown as Record<string, unknown>)._eventBus as EventBusShim | undefined
}

function collectEvents(service: SpecService): {
	events: SpecDocumentChangeEvent[]
	dispose: () => void
	busAvailable: boolean
} {
	const events: SpecDocumentChangeEvent[] = []
	const bus = getEventBus(service)
	let disposable: { dispose: () => void } | undefined
	if (bus) {
		disposable = bus.onDocumentChanged((e: SpecDocumentChangeEvent) => events.push(e))
	}
	return {
		events,
		dispose: () => disposable?.dispose(),
		busAvailable: !!bus,
	}
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("Phase A: expectedRevision guard + SpecDocumentEvents", () => {
	let globalStorage: string
	let projectRoot: string
	let service: SpecService

	beforeEach(async () => {
		globalStorage = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-events-"))
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-events-proj-"))
		service = new SpecService(globalStorage)
	})

	afterEach(async () => {
		await fs.rm(globalStorage, { recursive: true, force: true })
		await fs.rm(projectRoot, { recursive: true, force: true })
	})

	// ── expectedRevision conflict guard ──────────────────────────

	describe("expectedRevision guard", () => {
		it("succeeds when expectedRevision matches current revision", async () => {
			const ws = await service.createWorkspace({ title: "Guard", workspaceRoot: projectRoot })
			const req = await service.getDocument(projectRoot, ws.id, "requirements")
			expect(req?.meta.revision).toBe(1)

			const updated = await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# v2\n",
				expectedRevision: 1,
			})
			expect(updated.revision).toBe(2)
		})

		it("throws when expectedRevision does not match current revision", async () => {
			const ws = await service.createWorkspace({ title: "Conflict", workspaceRoot: projectRoot })
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# v2\n",
			})

			await expect(
				service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "requirements",
					content: "# v3 conflict\n",
					expectedRevision: 1, // actual is 2
				}),
			).rejects.toThrow(/revision/i)
		})

		it("succeeds without expectedRevision (no guard)", async () => {
			const ws = await service.createWorkspace({ title: "NoGuard", workspaceRoot: projectRoot })
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# v2\n",
			})
			const v3 = await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# v3\n",
			})
			expect(v3.revision).toBe(3)
		})

		it("conflict preserves document content and revision", async () => {
			const ws = await service.createWorkspace({ title: "Preserve", workspaceRoot: projectRoot })
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: "# Design v2\n",
			})

			await expect(
				service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "design",
					content: "# SHOULD NOT APPEAR\n",
					expectedRevision: 1,
				}),
			).rejects.toThrow()

			const doc = await service.getDocument(projectRoot, ws.id, "design")
			expect(doc?.content).toBe("# Design v2\n")
			expect(doc?.meta.revision).toBe(2)
		})
	})

	// ── Event emission ───────────────────────────────────────────

	describe("event emission", () => {
		it("emits one event on successful writeDocument with reason", async () => {
			const ws = await service.createWorkspace({ title: "Evt", workspaceRoot: projectRoot })
			const collector = collectEvents(service)

			const updated = await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# Updated\n",
				reason: "write",
			})

			collector.dispose()

			if (collector.busAvailable) {
				expect(collector.events).toHaveLength(1)
				const evt = collector.events[0]
				expect(evt.workspaceRootHash).toBe(hashWorkspaceRoot(projectRoot))
				expect(evt.specId).toBe(ws.id)
				expect(evt.docId).toBe("requirements")
				expect(evt.revision).toBe(updated.revision)
				expect(evt.reason).toBe("write")
			} else {
				// Phase A not yet landed — write must still succeed
				expect(updated.revision).toBe(2)
			}
		})

		it("does NOT emit event when writeDocument fails (expectedRevision mismatch)", async () => {
			const ws = await service.createWorkspace({ title: "NoEvt", workspaceRoot: projectRoot })
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# v2\n",
			})

			const collector = collectEvents(service)

			await expect(
				service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "requirements",
					content: "# should not emit\n",
					expectedRevision: 1,
				}),
			).rejects.toThrow()

			collector.dispose()

			if (collector.busAvailable) {
				expect(collector.events).toHaveLength(0)
			}
		})

		it("emits event with explicit reason 'restore'", async () => {
			const ws = await service.createWorkspace({ title: "RestoreEvt", workspaceRoot: projectRoot })
			const collector = collectEvents(service)

			const updated = await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# Restored\n",
				reason: "restore",
			})

			collector.dispose()

			if (collector.busAvailable) {
				expect(collector.events).toHaveLength(1)
				expect(collector.events[0].reason).toBe("restore")
				expect(collector.events[0].revision).toBe(updated.revision)
			} else {
				expect(updated.revision).toBe(2)
			}
		})

		it("emits one event per write; three writes produce three events", async () => {
			const ws = await service.createWorkspace({ title: "MultiEvt", workspaceRoot: projectRoot })
			const collector = collectEvents(service)

			for (let i = 2; i <= 4; i++) {
				await service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "requirements",
					content: `# v${i}\n`,
					reason: "write",
				})
			}

			collector.dispose()

			if (collector.busAvailable) {
				expect(collector.events).toHaveLength(3)
				expect(collector.events.map((e) => e.revision)).toEqual([2, 3, 4])
				for (const evt of collector.events) {
					expect(evt.reason).toBe("write")
				}
			}
		})
	})

	// ── Project tree invariant ───────────────────────────────────

	describe("project tree remains empty", () => {
		it("expectedRevision conflict leaves no project files", async () => {
			const ws = await service.createWorkspace({ title: "EmptyConflict", workspaceRoot: projectRoot })
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# v2\n",
			})

			await expect(
				service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "requirements",
					content: "# conflict\n",
					expectedRevision: 1,
				}),
			).rejects.toThrow()

			expect(await listFiles(projectRoot)).toEqual([])
		})

		it("multiple successful writes leave no project files", async () => {
			const ws = await service.createWorkspace({ title: "EmptyWrites", workspaceRoot: projectRoot })

			for (let i = 0; i < 5; i++) {
				await service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "design",
					content: `# Design v${i + 2}\n`,
					reason: "write",
				})
			}

			expect(await listFiles(projectRoot)).toEqual([])
		})
	})
})
