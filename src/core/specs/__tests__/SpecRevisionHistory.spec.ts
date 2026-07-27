/**
 * F-016 — Spec Revision History
 *
 * Architecture: F-009-F-010-F-011-F-015-F-016-architecture-review.md §7
 *
 * Planned APIs (additive on SpecService):
 *   - listDocumentRevisions(workspaceRoot, specId, docIdOrKind): Promise<SpecRevisionEntry[]>
 *   - getDocumentRevision(workspaceRoot, specId, docIdOrKind, revision): Promise<string>
 *   - restoreDocumentRevision(input): Promise<SpecDocument>
 *
 * Planned types (additive on types.ts):
 *   - SpecRevisionEntry { revision, createdAt, contentHash, byteLength, reason }
 *   - WriteSpecDocumentInput.expectedRevision?: number
 *   - WriteSpecDocumentInput.reason?: string
 *
 * Storage layout (sidecar, additive):
 *   history/<docId>/<revision>.md   — immutable full snapshot
 *   history/<docId>/index.json      — SpecRevisionEntry[]
 *
 * These tests are forward-looking specifications for Phase A + Phase B.
 * They exercise SpecService on real disk with tmp dirs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { createHash } from "crypto"

import { SpecService } from "../SpecService"
import { hashWorkspaceRoot } from "../paths"

/* ------------------------------------------------------------------ */
/*  Planned types                                                     */
/* ------------------------------------------------------------------ */

interface SpecRevisionEntry {
	revision: number
	createdAt: number
	contentHash: string
	byteLength: number
	reason: string
}

interface RestoreDocumentRevisionInput {
	specId: string
	workspaceRoot: string
	docIdOrKind: string
	revision: number
	expectedCurrentRevision?: number
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

function sha256(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex")
}

/**
 * Read a revision snapshot directly from history sidecar on disk.
 * Planned layout: <specDir>/history/<docId>/<revision>.md
 */
async function readSnapshotFromDisk(
	globalStorage: string,
	workspaceRootHash: string,
	specId: string,
	docId: string,
	revision: number,
): Promise<string | null> {
	const snapshotPath = path.join(
		globalStorage,
		"specs",
		workspaceRootHash,
		specId,
		"history",
		docId,
		`${revision}.md`,
	)
	try {
		return await fs.readFile(snapshotPath, "utf8")
	} catch {
		return null
	}
}

/**
 * Read the history index from disk.
 * Planned layout: <specDir>/history/<docId>/index.json
 */
async function readHistoryIndexFromDisk(
	globalStorage: string,
	workspaceRootHash: string,
	specId: string,
	docId: string,
): Promise<SpecRevisionEntry[] | null> {
	const indexPath = path.join(globalStorage, "specs", workspaceRootHash, specId, "history", docId, "index.json")
	try {
		const raw = await fs.readFile(indexPath, "utf8")
		return JSON.parse(raw) as SpecRevisionEntry[]
	} catch {
		return null
	}
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("F-016: Spec Revision History", () => {
	let globalStorage: string
	let projectRoot: string
	let service: SpecService

	beforeEach(async () => {
		globalStorage = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-revhist-"))
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-revhist-proj-"))
		service = new SpecService(globalStorage)
	})

	afterEach(async () => {
		await fs.rm(globalStorage, { recursive: true, force: true })
		await fs.rm(projectRoot, { recursive: true, force: true })
	})

	// ── Revision list / read ─────────────────────────────────────

	describe("listDocumentRevisions / getDocumentRevision", () => {
		it("returns empty revision list for a freshly created document (before first post-feature write)", async () => {
			const ws = await service.createWorkspace({ title: "Fresh", workspaceRoot: projectRoot })

			// Planned API: listDocumentRevisions
			const revisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "requirements")

			// Revision 1 exists at creation (starter doc) but history may be lazy-initialized
			// Architecture §4.3: "Revision 1 is backfilled lazily from the pre-write body
			// when the first history-aware write occurs."
			// So before any post-feature write, the list may be empty or contain revision 1
			expect(Array.isArray(revisions)).toBe(true)
		})

		it("after writeDocument, listDocumentRevisions includes the new revision", async () => {
			const ws = await service.createWorkspace({ title: "AfterWrite", workspaceRoot: projectRoot })

			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# Requirements v2\n",
				reason: "write",
			})

			const revisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "requirements")

			expect(revisions.length).toBeGreaterThanOrEqual(1)
			// The latest entry should be revision 2 (the write we just did)
			const latest = revisions[revisions.length - 1]
			expect(latest.revision).toBe(2)
			expect(latest.reason).toBe("write")
			expect(latest.contentHash).toBe(sha256("# Requirements v2\n"))
			expect(latest.byteLength).toBe(Buffer.byteLength("# Requirements v2\n", "utf8"))
		})

		it("getDocumentRevision returns the correct content for each revision", async () => {
			const ws = await service.createWorkspace({ title: "ReadRev", workspaceRoot: projectRoot })

			const contentV2 = "# Design v2\n"
			const contentV3 = "# Design v3 — complete\n"

			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: contentV2,
				reason: "write",
			})
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: contentV3,
				reason: "write",
			})

			// Planned API: getDocumentRevision
			const getRev = (
				service as unknown as {
					getDocumentRevision: (wr: string, si: string, dk: string, rev: number) => Promise<string>
				}
			).getDocumentRevision

			const rev2 = await getRev(projectRoot, ws.id, "design", 2)
			expect(rev2).toBe(contentV2)

			const rev3 = await getRev(projectRoot, ws.id, "design", 3)
			expect(rev3).toBe(contentV3)
		})

		it("revision entries are ordered by revision ascending", async () => {
			const ws = await service.createWorkspace({ title: "Order", workspaceRoot: projectRoot })

			for (let i = 2; i <= 5; i++) {
				await service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "tasks",
					content: `# Tasks v${i}\n`,
					reason: "write",
				})
			}

			const revisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "tasks")

			for (let i = 1; i < revisions.length; i++) {
				expect(revisions[i].revision).toBeGreaterThan(revisions[i - 1].revision)
			}
		})
	})

	// ── Lazy revision-1 history backfill ─────────────────────────

	describe("lazy revision-1 backfill", () => {
		it("first post-feature write backfills revision 1 from pre-write body", async () => {
			const ws = await service.createWorkspace({ title: "LazyBackfill", workspaceRoot: projectRoot })

			// Pre-condition: the starter content for requirements
			const original = await service.getDocument(projectRoot, ws.id, "requirements")
			expect(original?.content).toContain("# Requirements")

			// First write triggers lazy backfill of revision 1
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# Requirements v2\n",
				reason: "write",
			})

			const revisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "requirements")

			// Should have revision 1 (backfilled) + revision 2 (just written)
			expect(revisions.length).toBeGreaterThanOrEqual(2)

			const rev1 = revisions.find((r) => r.revision === 1)
			expect(rev1).toBeDefined()

			// Revision 1 snapshot content should be the original starter body
			const getRev = (
				service as unknown as {
					getDocumentRevision: (wr: string, si: string, dk: string, rev: number) => Promise<string>
				}
			).getDocumentRevision

			const rev1Content = await getRev(projectRoot, ws.id, "requirements", 1)
			expect(rev1Content).toContain("# Requirements")
			expect(rev1Content).not.toBe("# Requirements v2\n")
		})

		it("lazy backfill uses reason 'initial' for revision 1", async () => {
			const ws = await service.createWorkspace({ title: "LazyReason", workspaceRoot: projectRoot })

			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: "# Design v2\n",
				reason: "write",
			})

			const revisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "design")

			const rev1 = revisions.find((r) => r.revision === 1)
			expect(rev1).toBeDefined()
			// The backfilled revision 1 should have a distinguishable reason
			expect(rev1!.reason).toMatch(/initial|create|backfill/i)
		})
	})

	// ── One snapshot per durable write ───────────────────────────

	describe("one snapshot per durable write", () => {
		it("each writeDocument call creates exactly one new history entry", async () => {
			const ws = await service.createWorkspace({ title: "OneSnap", workspaceRoot: projectRoot })

			// First write triggers lazy backfill (revision 1) + creates revision 2
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# v2\n",
				reason: "write",
			})

			let revisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "requirements")
			// Backfilled 1 + written 2 = 2
			const countAfterFirst = revisions.length

			// Second write should add exactly one more entry
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# v3\n",
				reason: "write",
			})

			revisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "requirements")
			expect(revisions.length).toBe(countAfterFirst + 1)
		})

		it("writing different documents creates independent history tracks", async () => {
			const ws = await service.createWorkspace({ title: "Tracks", workspaceRoot: projectRoot })

			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# Req v2\n",
				reason: "write",
			})
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: "# Design v2\n",
				reason: "write",
			})

			const listRevs = (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions

			const reqRevisions = await listRevs(projectRoot, ws.id, "requirements")
			const designRevisions = await listRevs(projectRoot, ws.id, "design")

			// Each document should have its own independent history
			expect(reqRevisions.length).toBeGreaterThanOrEqual(2)
			expect(designRevisions.length).toBeGreaterThanOrEqual(2)

			// History sidecar directories should be separate
			const hash = hashWorkspaceRoot(projectRoot)
			const reqSnapshot = await readSnapshotFromDisk(globalStorage, hash, ws.id, "requirements", 2)
			const designSnapshot = await readSnapshotFromDisk(globalStorage, hash, ws.id, "design", 2)
			expect(reqSnapshot).toBe("# Req v2\n")
			expect(designSnapshot).toBe("# Design v2\n")
		})
	})

	// ── expectedRevision conflict with history ───────────────────

	describe("expectedRevision conflict and history", () => {
		it("conflicting write creates no history entry", async () => {
			const ws = await service.createWorkspace({ title: "ConflictHist", workspaceRoot: projectRoot })

			// Bump to revision 2
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# v2\n",
				reason: "write",
			})

			const beforeRevisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "requirements")

			const countBefore = beforeRevisions.length

			// Conflict
			await expect(
				service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "requirements",
					content: "# conflict\n",
					expectedRevision: 1,
				}),
			).rejects.toThrow(/revision/i)

			const afterRevisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "requirements")

			// No new revision added
			expect(afterRevisions.length).toBe(countBefore)
		})
	})

	// ── Restore as new forward revision ──────────────────────────

	describe("restoreDocumentRevision — new forward revision", () => {
		it("restoring an old revision creates a new forward revision (never rewinds)", async () => {
			const ws = await service.createWorkspace({ title: "Restore", workspaceRoot: projectRoot })

			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: "# Design v2 — original approach\n",
				reason: "write",
			})
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: "# Design v3 — new approach\n",
				reason: "write",
			})

			// Current revision is 3; restore revision 2 → should create revision 4
			const restored = await (
				service as unknown as {
					restoreDocumentRevision: (
						input: RestoreDocumentRevisionInput,
					) => Promise<{ id: string; revision: number }>
				}
			).restoreDocumentRevision({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				revision: 2,
			})

			expect(restored.revision).toBe(4) // not 2 — forward commit

			// Current document content should match revision 2
			const doc = await service.getDocument(projectRoot, ws.id, "design")
			expect(doc?.content).toBe("# Design v2 — original approach\n")
			expect(doc?.meta.revision).toBe(4)

			// History should have 4 entries (1 backfilled + 2 writes + 1 restore)
			const revisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "design")

			const maxRev = Math.max(...revisions.map((r) => r.revision))
			expect(maxRev).toBe(4)

			// Revision counter never goes backward
			for (let i = 1; i < revisions.length; i++) {
				expect(revisions[i].revision).toBeGreaterThan(revisions[i - 1].revision)
			}
		})

		it("restore revision 1 from lazy backfill works correctly", async () => {
			const ws = await service.createWorkspace({ title: "RestoreLazy", workspaceRoot: projectRoot })

			// First write triggers lazy backfill of revision 1
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# Requirements v2\n",
				reason: "write",
			})
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# Requirements v3\n",
				reason: "write",
			})

			// Restore to revision 1 (the backfilled original)
			const restored = await (
				service as unknown as {
					restoreDocumentRevision: (
						input: RestoreDocumentRevisionInput,
					) => Promise<{ id: string; revision: number }>
				}
			).restoreDocumentRevision({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				revision: 1,
			})

			expect(restored.revision).toBe(4) // 1→2→3→4

			const doc = await service.getDocument(projectRoot, ws.id, "requirements")
			expect(doc?.content).toContain("# Requirements")
			expect(doc?.content).not.toBe("# Requirements v2\n")
			expect(doc?.content).not.toBe("# Requirements v3\n")
		})

		it("restore with expectedCurrentRevision conflict when current has changed", async () => {
			const ws = await service.createWorkspace({ title: "RestoreConflict", workspaceRoot: projectRoot })

			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: "# v2\n",
				reason: "write",
			})
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: "# v3\n",
				reason: "write",
			})

			// Try to restore revision 2 but claim current is 2 (actually 3)
			await expect(
				(
					service as unknown as {
						restoreDocumentRevision: (input: RestoreDocumentRevisionInput) => Promise<unknown>
					}
				).restoreDocumentRevision({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "design",
					revision: 2,
					expectedCurrentRevision: 2, // wrong: actual is 3
				}),
			).rejects.toThrow(/revision/i)

			// Content unchanged
			const doc = await service.getDocument(projectRoot, ws.id, "design")
			expect(doc?.content).toBe("# v3\n")
			expect(doc?.meta.revision).toBe(3)
		})
	})

	// ── Retention ────────────────────────────────────────────────

	describe("retention policy", () => {
		it("retains last 50 snapshots per document; prunes older ones", async () => {
			const ws = await service.createWorkspace({ title: "Retention", workspaceRoot: projectRoot })

			// Write 55 revisions
			for (let i = 2; i <= 55; i++) {
				await service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "requirements",
					content: `# Requirements v${i}\n`,
					reason: "write",
				})
			}

			const revisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "requirements")

			// Architecture §7: "Default retention: last 50 snapshots per document"
			// Should have at most 50 entries in the index
			// But actual snapshots on disk may be pruned
			expect(revisions.length).toBeLessThanOrEqual(50)

			// The latest revision (55) must be present
			const latest = revisions.find((r) => r.revision === 55)
			expect(latest).toBeDefined()

			// Older pruned revisions should not be in the index
			const oldest = revisions.find((r) => r.revision === 1)
			// Revision 1 may or may not be pruned depending on retention
			// But the current revision MUST always be kept
			expect(revisions.some((r) => r.revision === 55)).toBe(true)
		})

		it("never deletes the current revision snapshot during pruning", async () => {
			const ws = await service.createWorkspace({ title: "KeepCurrent", workspaceRoot: projectRoot })

			for (let i = 2; i <= 52; i++) {
				await service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "design",
					content: `# Design v${i}\n`,
					reason: "write",
				})
			}

			const hash = hashWorkspaceRoot(projectRoot)
			const currentSnapshot = await readSnapshotFromDisk(globalStorage, hash, ws.id, "design", 52)
			expect(currentSnapshot).toBe("# Design v52\n")
		})
	})

	// ── Recovery ─────────────────────────────────────────────────

	describe("recovery from partial state", () => {
		it("history index and snapshot content hash match after multiple writes", async () => {
			const ws = await service.createWorkspace({ title: "Recovery", workspaceRoot: projectRoot })

			const contents = ["# v2\n", "# v3 — longer content for hash\n", "# v4\n"]
			for (const [i, content] of contents.entries()) {
				await service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "requirements",
					content,
					reason: "write",
				})

				const revisions = await (
					service as unknown as {
						listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
					}
				).listDocumentRevisions(projectRoot, ws.id, "requirements")

				const latest = revisions[revisions.length - 1]
				expect(latest.contentHash).toBe(sha256(content))
				expect(latest.byteLength).toBe(Buffer.byteLength(content, "utf8"))
			}
		})

		it("getDocumentRevision content matches contentHash in history index", async () => {
			const ws = await service.createWorkspace({ title: "HashMatch", workspaceRoot: projectRoot })

			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "tasks",
				content: "# Tasks v2\n- [ ] item 1\n- [ ] item 2\n",
				reason: "write",
			})

			const revisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "tasks")

			const rev2 = revisions.find((r) => r.revision === 2)
			expect(rev2).toBeDefined()

			const content = await (
				service as unknown as {
					getDocumentRevision: (wr: string, si: string, dk: string, rev: number) => Promise<string>
				}
			).getDocumentRevision(projectRoot, ws.id, "tasks", 2)

			expect(sha256(content)).toBe(rev2!.contentHash)
		})
	})

	// ── Snapshot storage on disk ─────────────────────────────────

	describe("snapshot sidecar storage", () => {
		it("snapshots are stored as immutable markdown files under history/<docId>/", async () => {
			const ws = await service.createWorkspace({ title: "Sidecar", workspaceRoot: projectRoot })

			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: "# Design v2\n",
				reason: "write",
			})

			const hash = hashWorkspaceRoot(projectRoot)
			const specDir = path.join(globalStorage, "specs", hash, ws.id)

			// History directory should exist
			const historyDir = path.join(specDir, "history", "design")
			const historyFiles = await fs.readdir(historyDir)
			expect(historyFiles).toContain("1.md") // lazy backfilled
			expect(historyFiles).toContain("2.md") // just written
			expect(historyFiles).toContain("index.json")
		})

		it("existing schema-v1 packs work before and after first history-aware write", async () => {
			const ws = await service.createWorkspace({ title: "SchemaV1", workspaceRoot: projectRoot })

			// Before any post-feature write, the pack is schema-v1 compatible
			const meta = await service.getWorkspace(projectRoot, ws.id)
			expect(meta?.schemaVersion).toBe(1)

			// Documents readable
			const doc = await service.getDocument(projectRoot, ws.id, "requirements")
			expect(doc?.content).toContain("# Requirements")

			// First write creates history without breaking the pack
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# Requirements v2\n",
				reason: "write",
			})

			// Pack still works
			const metaAfter = await service.getWorkspace(projectRoot, ws.id)
			expect(metaAfter?.schemaVersion).toBe(1)
			const docAfter = await service.getDocument(projectRoot, ws.id, "requirements")
			expect(docAfter?.content).toBe("# Requirements v2\n")
			expect(docAfter?.meta.revision).toBe(2)
		})
	})

	// ── Project tree remains empty ───────────────────────────────

	describe("project tree remains empty", () => {
		it("revision history operations create no project files", async () => {
			const ws = await service.createWorkspace({ title: "TreeEmpty", workspaceRoot: projectRoot })

			// Write multiple revisions
			for (let i = 2; i <= 5; i++) {
				await service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "requirements",
					content: `# v${i}\n`,
					reason: "write",
				})
			}

			// List revisions
			const revisions = await (
				service as unknown as {
					listDocumentRevisions: (wr: string, si: string, dk: string) => Promise<SpecRevisionEntry[]>
				}
			).listDocumentRevisions(projectRoot, ws.id, "requirements")
			expect(revisions.length).toBeGreaterThanOrEqual(4)

			// Read old revision
			await (
				service as unknown as {
					getDocumentRevision: (wr: string, si: string, dk: string, rev: number) => Promise<string>
				}
			).getDocumentRevision(projectRoot, ws.id, "requirements", 2)

			expect(await listFiles(projectRoot)).toEqual([])
		})

		it("restore creates no project files", async () => {
			const ws = await service.createWorkspace({ title: "RestoreTree", workspaceRoot: projectRoot })

			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: "# v2\n",
				reason: "write",
			})
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				content: "# v3\n",
				reason: "write",
			})

			await (
				service as unknown as {
					restoreDocumentRevision: (input: RestoreDocumentRevisionInput) => Promise<unknown>
				}
			).restoreDocumentRevision({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "design",
				revision: 2,
			})

			expect(await listFiles(projectRoot)).toEqual([])
		})

		it("55 writes + retention pruning leaves no project files", async () => {
			const ws = await service.createWorkspace({ title: "RetentionTree", workspaceRoot: projectRoot })

			for (let i = 2; i <= 55; i++) {
				await service.writeDocument({
					specId: ws.id,
					workspaceRoot: projectRoot,
					docIdOrKind: "requirements",
					content: `# v${i}\n`,
					reason: "write",
				})
			}

			expect(await listFiles(projectRoot)).toEqual([])
		})
	})

	// ── History index integrity ──────────────────────────────────

	describe("history index integrity", () => {
		it("history index.json on disk is valid JSON array of SpecRevisionEntry", async () => {
			const ws = await service.createWorkspace({ title: "IndexInteg", workspaceRoot: projectRoot })

			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# v2\n",
				reason: "write",
			})

			const hash = hashWorkspaceRoot(projectRoot)
			const index = await readHistoryIndexFromDisk(globalStorage, hash, ws.id, "requirements")

			expect(index).not.toBeNull()
			expect(Array.isArray(index)).toBe(true)
			expect(index!.length).toBeGreaterThanOrEqual(2)

			for (const entry of index!) {
				expect(typeof entry.revision).toBe("number")
				expect(typeof entry.createdAt).toBe("number")
				expect(typeof entry.contentHash).toBe("string")
				expect(typeof entry.byteLength).toBe("number")
				expect(typeof entry.reason).toBe("string")
			}
		})
	})
})
