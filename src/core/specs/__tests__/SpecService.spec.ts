import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { SpecService } from "../SpecService"
import { hashWorkspaceRoot } from "../paths"

describe("SpecService", () => {
	let globalStorage: string
	/** Simulated user project — SpecService must never write here. */
	let projectRoot: string
	let service: SpecService

	beforeEach(async () => {
		globalStorage = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-global-"))
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-project-"))
		service = new SpecService(globalStorage)
	})

	afterEach(async () => {
		await fs.rm(globalStorage, { recursive: true, force: true })
		await fs.rm(projectRoot, { recursive: true, force: true })
	})

	async function listProjectFiles(): Promise<string[]> {
		const walk = async (dir: string): Promise<string[]> => {
			const out: string[] = []
			const entries = await fs.readdir(dir, { withFileTypes: true })
			for (const e of entries) {
				const full = path.join(dir, e.name)
				if (e.isDirectory()) {
					out.push(...(await walk(full)))
				} else {
					out.push(path.relative(projectRoot, full))
				}
			}
			return out
		}
		return walk(projectRoot)
	}

	it("creates workspace with three starter docs under global storage", async () => {
		const ws = await service.createWorkspace({
			title: "Feature X",
			workspaceRoot: projectRoot,
		})

		expect(ws.title).toBe("Feature X")
		expect(ws.docs.map((d) => d.kind).sort()).toEqual(["design", "requirements", "tasks"])
		expect(ws.taskIds).toEqual([])
		expect(ws.schemaVersion).toBe(1)

		const list = await service.listWorkspaces(projectRoot)
		expect(list).toHaveLength(1)
		expect(list[0].id).toBe(ws.id)

		const req = await service.getDocument(projectRoot, ws.id, "requirements")
		expect(req?.content).toContain("# Requirements")

		// All files under globalStorage/specs/...
		const hash = hashWorkspaceRoot(projectRoot)
		const specDir = path.join(globalStorage, "specs", hash, ws.id)
		await expect(fs.access(path.join(specDir, "meta.json"))).resolves.toBeUndefined()
		await expect(fs.access(path.join(specDir, "docs", "design.md"))).resolves.toBeUndefined()

		// Project remains empty
		expect(await listProjectFiles()).toEqual([])
	})

	it("writes document content, bumps revision, and survives new service instance", async () => {
		const ws = await service.createWorkspace({
			title: "Persist me",
			workspaceRoot: projectRoot,
		})

		const updated = await service.writeDocument({
			specId: ws.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "design",
			content: "# Design\n\n mermaid here\n",
		})
		expect(updated.revision).toBe(2)
		expect(updated.kind).toBe("design")

		const reloaded = new SpecService(globalStorage)
		const doc = await reloaded.getDocument(projectRoot, ws.id, "design")
		expect(doc?.content).toBe("# Design\n\n mermaid here\n")
		expect(doc?.meta.revision).toBe(2)

		const meta = await reloaded.getWorkspace(projectRoot, ws.id)
		expect(meta?.updatedAt).toBeGreaterThanOrEqual(ws.updatedAt)
		expect(await listProjectFiles()).toEqual([])
	})

	it("isolates specs across different workspace roots", async () => {
		const otherProject = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-other-"))
		try {
			const a = await service.createWorkspace({ title: "A", workspaceRoot: projectRoot })
			const b = await service.createWorkspace({ title: "B", workspaceRoot: otherProject })

			const listA = await service.listWorkspaces(projectRoot)
			const listB = await service.listWorkspaces(otherProject)

			expect(listA.map((e) => e.id)).toEqual([a.id])
			expect(listB.map((e) => e.id)).toEqual([b.id])
			expect(await service.getWorkspace(projectRoot, b.id)).toBeNull()
		} finally {
			await fs.rm(otherProject, { recursive: true, force: true })
		}
	})

	it("rejects unsafe spec ids on write/get/delete", async () => {
		const ws = await service.createWorkspace({ title: "Safe", workspaceRoot: projectRoot })

		await expect(
			service.writeDocument({
				specId: "../evil",
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "x",
			}),
		).rejects.toThrow(/Invalid specId/)

		await expect(service.getWorkspace(projectRoot, "foo/bar")).rejects.toThrow(/Invalid specId/)
		await expect(service.deleteWorkspace(projectRoot, "..")).rejects.toThrow()

		// Still only original workspace
		expect(await service.getWorkspace(projectRoot, ws.id)).not.toBeNull()
		expect(await listProjectFiles()).toEqual([])
	})

	it("deletes workspace from disk and index", async () => {
		const ws = await service.createWorkspace({ title: "Temp", workspaceRoot: projectRoot })
		await service.deleteWorkspace(projectRoot, ws.id)
		expect(await service.getWorkspace(projectRoot, ws.id)).toBeNull()
		expect(await service.listWorkspaces(projectRoot)).toEqual([])
		expect(await listProjectFiles()).toEqual([])
	})

	it("throws when writing unknown document kind", async () => {
		const ws = await service.createWorkspace({ title: "Docs", workspaceRoot: projectRoot })
		await expect(
			service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "missing-doc",
				content: "x",
			}),
		).rejects.toThrow(/Document not found/)
	})

	it("F-022c: writeDocument ensures missing allowlisted kind inside same sparse pack", async () => {
		const ws = await service.createWorkspaceFromDocuments({
			title: "Imported Design Only",
			workspaceRoot: projectRoot,
			documents: [
				{
					id: "design",
					kind: "design",
					title: "Imported Design",
					fileName: "design.md",
					content: "# Design\n\nbody\n",
				},
			],
			reason: "import",
		})
		expect(ws.docs.map((d) => d.kind)).toEqual(["design"])

		const tasks = await service.writeDocument({
			specId: ws.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "tasks",
			content: "# Tasks\n\n- [ ] one\n",
		})
		expect(tasks.kind).toBe("tasks")
		expect(tasks.id).toBe("tasks")

		const reloaded = await service.getWorkspace(projectRoot, ws.id)
		expect(reloaded?.docs.map((d) => d.kind).sort()).toEqual(["design", "tasks"])
		const tasksBody = await service.getDocument(projectRoot, ws.id, "tasks")
		expect(tasksBody?.content).toBe("# Tasks\n\n- [ ] one\n")
		const designBody = await service.getDocument(projectRoot, ws.id, "design")
		expect(designBody?.content).toBe("# Design\n\nbody\n")
		expect(await listProjectFiles()).toEqual([])
	})
})
