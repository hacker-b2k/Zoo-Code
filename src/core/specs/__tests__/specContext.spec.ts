import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { SpecService } from "../SpecService"
import { formatSpecContextBlock, invalidateSpecContextCache, SPEC_CONTEXT_MAX_CHARS } from "../specContext"

describe("specContext (F-006)", () => {
	let globalStorage: string
	let projectRoot: string

	beforeEach(async () => {
		invalidateSpecContextCache()
		globalStorage = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-f006-g-"))
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-f006-p-"))
	})

	afterEach(async () => {
		invalidateSpecContextCache()
		await fs.rm(globalStorage, { recursive: true, force: true }).catch(() => {})
		await fs.rm(projectRoot, { recursive: true, force: true }).catch(() => {})
	})

	it("formats empty packs with create hint", async () => {
		const service = new SpecService(globalStorage)
		const text = await formatSpecContextBlock({
			service,
			cwd: projectRoot,
			entries: [],
		})
		expect(text).toContain("Spec Workspace")
		expect(text).toContain("(none)")
		expect(text).toContain("spec_id: null")
		expect(text).not.toMatch(/^# Design/m) // no full body
	})

	it("includes pack titles, stages, and doc revisions without full markdown", async () => {
		const service = new SpecService(globalStorage)
		const ws = await service.createWorkspace({ title: "Auth System", workspaceRoot: projectRoot })
		await service.writeDocument({
			specId: ws.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "design",
			content: "# Huge Design\n\n" + "x".repeat(5000),
		})
		const entries = await service.listWorkspaces(projectRoot)
		const text = await formatSpecContextBlock({
			service,
			cwd: projectRoot,
			entries,
			lastOpenedSpecId: ws.id,
			lastOpenedDocKind: "design",
		})
		expect(text).toContain("Auth System")
		expect(text).toContain("Active:")
		expect(text).toContain("design@r")
		expect(text).toContain("lastDoc=design")
		expect(text).not.toContain("x".repeat(100))
		expect(text.length).toBeLessThanOrEqual(SPEC_CONTEXT_MAX_CHARS)
		// F-006b: never present truncated values as bare tool ids
		expect(text).not.toMatch(/\bid=[a-zA-Z0-9]{8}…/)
		expect(text).toMatch(/NOT a tool|not tool id|display_prefix/i)
		expect(text).toContain("spec_id: null")
	})

	it("truncates with +N more when many packs", async () => {
		const service = new SpecService(globalStorage)
		for (let i = 0; i < 10; i++) {
			await service.createWorkspace({ title: `Pack ${i}`, workspaceRoot: projectRoot })
		}
		const entries = await service.listWorkspaces(projectRoot)
		const text = await formatSpecContextBlock({
			service,
			cwd: projectRoot,
			entries,
			maxPacks: 3,
		})
		expect(text).toContain("+7 more")
		expect(text).toContain("list_specs")
	})
})
