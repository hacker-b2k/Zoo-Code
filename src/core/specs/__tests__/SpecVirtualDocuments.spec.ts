import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

vi.mock("vscode", () => {
	class MockUri {
		constructor(
			readonly scheme: string,
			readonly authority: string,
			readonly path: string,
			readonly query: string,
		) {}

		static parse(value: string): MockUri {
			const url = new URL(value)
			return new MockUri(url.protocol.slice(0, -1), url.host, url.pathname, url.search.slice(1))
		}

		toString(): string {
			return `${this.scheme}://${this.authority}${this.path}${this.query ? `?${this.query}` : ""}`
		}
	}

	class MockEventEmitter<T> {
		private readonly listeners = new Set<(value: T) => void>()
		readonly event = (listener: (value: T) => void) => {
			this.listeners.add(listener)
			return { dispose: () => this.listeners.delete(listener) }
		}
		fire(value: T): void {
			for (const listener of this.listeners) listener(value)
		}
		dispose(): void {
			this.listeners.clear()
		}
	}

	return { Uri: MockUri, EventEmitter: MockEventEmitter }
})

import { SpecService } from "../SpecService"
import { SpecDocumentContentProvider } from "../virtualDocs/SpecDocumentContentProvider"
import { buildSpecDocumentUri, parseSpecDocumentUri, specDocumentIdentityKey } from "../virtualDocs/specUri"

describe("F-009 zoo-spec virtual documents", () => {
	let globalStorage: string
	let projectRoot: string
	let service: SpecService

	beforeEach(async () => {
		globalStorage = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-tabs-global-"))
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-tabs-project-"))
		service = new SpecService(globalStorage)
	})

	afterEach(async () => {
		await fs.rm(globalStorage, { recursive: true, force: true })
		await fs.rm(projectRoot, { recursive: true, force: true })
	})

	it("round-trips current and numeric revision URIs", () => {
		const current = buildSpecDocumentUri({ workspaceRoot: projectRoot, specId: "spec-1", docId: "design" })
		const parsedCurrent = parseSpecDocumentUri(current)
		expect(parsedCurrent).toMatchObject({ specId: "spec-1", docId: "design", revision: "current" })

		const revision = buildSpecDocumentUri({
			workspaceRoot: projectRoot,
			specId: "spec-1",
			docId: "design",
			revision: 2,
		})
		expect(parseSpecDocumentUri(revision).revision).toBe(2)
		expect(revision.toString()).not.toBe(current.toString())
	})

	it("rejects malformed paths, traversal, and workspace hash mismatches", () => {
		const good = buildSpecDocumentUri({ workspaceRoot: projectRoot, specId: "spec-1", docId: "design" })
		const ctor = good.constructor as unknown as { parse(value: string): typeof good }
		expect(() =>
			parseSpecDocumentUri(ctor.parse(good.toString().replace(good.authority, "badbadbadbadbadb"))),
		).toThrow(/hash mismatch/i)
		expect(() =>
			parseSpecDocumentUri(ctor.parse("zoo-spec://abc123def4567890/../design.md?root=eA&rev=current")),
		).toThrow()
		expect(() => parseSpecDocumentUri(ctor.parse("zoo-spec://abc123def4567890/one/two/three.md?root=eA"))).toThrow()
	})

	it("uses independent identities for packs, documents, and revisions", () => {
		const a = parseSpecDocumentUri(
			buildSpecDocumentUri({ workspaceRoot: projectRoot, specId: "spec-a", docId: "requirements" }),
		)
		const b = parseSpecDocumentUri(
			buildSpecDocumentUri({ workspaceRoot: projectRoot, specId: "spec-b", docId: "requirements" }),
		)
		const design = parseSpecDocumentUri(
			buildSpecDocumentUri({ workspaceRoot: projectRoot, specId: "spec-a", docId: "design" }),
		)
		expect(specDocumentIdentityKey(a)).not.toBe(specDocumentIdentityKey(b))
		expect(specDocumentIdentityKey(a)).not.toBe(specDocumentIdentityKey(design))
	})

	it("serves current and immutable revision content", async () => {
		const ws = await service.createWorkspace({ title: "Tabs", workspaceRoot: projectRoot })
		await service.writeDocument({
			workspaceRoot: projectRoot,
			specId: ws.id,
			docIdOrKind: "design",
			content: "# Design v2\n",
		})
		const provider = new SpecDocumentContentProvider(globalStorage)
		try {
			const currentUri = buildSpecDocumentUri({ workspaceRoot: projectRoot, specId: ws.id, docId: "design" })
			const revisionUri = buildSpecDocumentUri({
				workspaceRoot: projectRoot,
				specId: ws.id,
				docId: "design",
				revision: 1,
			})
			expect(await provider.provideTextDocumentContent(currentUri)).toBe("# Design v2\n")
			expect(await provider.provideTextDocumentContent(revisionUri)).toContain("# Design")
		} finally {
			provider.dispose()
		}
	})

	it("refreshes matching current URIs only after durable writes", async () => {
		const ws = await service.createWorkspace({ title: "Refresh", workspaceRoot: projectRoot })
		const provider = new SpecDocumentContentProvider(globalStorage)
		const currentUri = buildSpecDocumentUri({ workspaceRoot: projectRoot, specId: ws.id, docId: "requirements" })
		const revisionUri = buildSpecDocumentUri({
			workspaceRoot: projectRoot,
			specId: ws.id,
			docId: "requirements",
			revision: 1,
		})
		await provider.provideTextDocumentContent(currentUri)
		await provider.provideTextDocumentContent(revisionUri).catch(() => undefined)
		const changed: string[] = []
		const subscription = provider.onDidChange((uri) => changed.push(uri.toString()))
		try {
			await service.writeDocument({
				workspaceRoot: projectRoot,
				specId: ws.id,
				docIdOrKind: "design",
				content: "# unrelated\n",
			})
			expect(changed).toEqual([])
			await service.writeDocument({
				workspaceRoot: projectRoot,
				specId: ws.id,
				docIdOrKind: "requirements",
				content: "# refreshed\n",
			})
			expect(changed).toEqual([currentUri.toString()])
			expect(changed).not.toContain(revisionUri.toString())
		} finally {
			subscription.dispose()
			provider.dispose()
		}
	})

	it("never writes into the project tree", async () => {
		const ws = await service.createWorkspace({ title: "Clean", workspaceRoot: projectRoot })
		const provider = new SpecDocumentContentProvider(globalStorage)
		try {
			await provider.provideTextDocumentContent(
				buildSpecDocumentUri({ workspaceRoot: projectRoot, specId: ws.id, docId: "tasks" }),
			)
			expect(await fs.readdir(projectRoot)).toEqual([])
		} finally {
			provider.dispose()
		}
	})
})
