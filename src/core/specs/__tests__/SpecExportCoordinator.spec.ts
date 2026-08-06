import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { SpecExportCoordinator } from "../export/SpecExportCoordinator"
import { SpecService } from "../SpecService"

describe("F-010 Materialize / Export", () => {
	let globalStorage: string
	let projectRoot: string
	let service: SpecService
	let coordinator: SpecExportCoordinator

	beforeEach(async () => {
		globalStorage = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-export-global-"))
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-export-project-"))
		service = new SpecService(globalStorage)
		coordinator = new SpecExportCoordinator(service)
	})

	afterEach(async () => {
		await fs.rm(globalStorage, { recursive: true, force: true })
		await fs.rm(projectRoot, { recursive: true, force: true })
	})

	async function seedSpec() {
		const ws = await service.createWorkspace({ title: "Export Me", workspaceRoot: projectRoot })
		await service.writeDocument({
			workspaceRoot: projectRoot,
			specId: ws.id,
			docIdOrKind: "requirements",
			content: "# Requirements\n\nExport body\n",
			expectedRevision: 1,
		})
		return ws
	}

	it("plans selected docs with default skip for existing targets", async () => {
		const ws = await seedSpec()
		await fs.writeFile(path.join(projectRoot, "requirements.md"), "existing\n", "utf8")
		const plan = await coordinator.plan({
			workspaceRoot: projectRoot,
			selections: [{ specId: ws.id, docId: "requirements" }],
			destinationDirectory: projectRoot,
		})
		expect(plan.skipped).toEqual([])
		expect(plan.items).toHaveLength(1)
		expect(plan.items[0].targetExists).toBe(true)
		expect(plan.items[0].proposedAction).toBe("skip")
	})

	it("exports new files under destination directory without changing virtual storage", async () => {
		const ws = await seedSpec()
		const beforeDoc = await service.getDocument(projectRoot, ws.id, "requirements")
		const dest = path.join(projectRoot, "out", "specs")
		const plan = await coordinator.plan({
			workspaceRoot: projectRoot,
			selections: [{ specId: ws.id, docId: "requirements" }],
			destinationDirectory: dest,
		})
		const result = await coordinator.commit({ workspaceRoot: projectRoot, items: plan.items })
		expect(result.rollbackAttempted).toBe(false)
		expect(result.results[0].status).toBe("created")
		const exported = await fs.readFile(path.join(dest, "requirements.md"), "utf8")
		expect(exported).toBe("# Requirements\n\nExport body\n")
		const afterDoc = await service.getDocument(projectRoot, ws.id, "requirements")
		expect(afterDoc?.meta.revision).toBe(beforeDoc?.meta.revision)
		expect(afterDoc?.content).toBe(beforeDoc?.content)
	})

	it("exports to a folder outside the project workspace (export anywhere)", async () => {
		const ws = await seedSpec()
		const outside = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-export-outside-"))
		try {
			const plan = await coordinator.plan({
				workspaceRoot: projectRoot,
				selections: [{ specId: ws.id, docId: "requirements" }],
				destinationDirectory: outside,
			})
			expect(plan.items).toHaveLength(1)
			const result = await coordinator.commit({ workspaceRoot: projectRoot, items: plan.items })
			expect(result.results[0].status).toBe("created")
			expect(await fs.readFile(path.join(outside, "requirements.md"), "utf8")).toContain("Export body")
			// Project still empty of export litter at root
			const rootFiles = await fs.readdir(projectRoot)
			expect(rootFiles).toEqual([])
		} finally {
			await fs.rm(outside, { recursive: true, force: true })
		}
	})

	it("skips conflicts by default and overwrites only when resolved", async () => {
		const ws = await seedSpec()
		const target = path.join(projectRoot, "requirements.md")
		await fs.writeFile(target, "keep me\n", "utf8")
		const plan = await coordinator.plan({
			workspaceRoot: projectRoot,
			selections: [{ specId: ws.id, docId: "requirements" }],
			destinationDirectory: projectRoot,
		})

		const skipped = await coordinator.commit({ workspaceRoot: projectRoot, items: plan.items })
		expect(skipped.results[0].status).toBe("skipped")
		expect(await fs.readFile(target, "utf8")).toBe("keep me\n")

		const overwritten = await coordinator.commit({
			workspaceRoot: projectRoot,
			items: plan.items,
			conflictResolutions: { "requirements.md": "overwrite" },
		})
		expect(overwritten.results[0].status).toBe("overwritten")
		expect(await fs.readFile(target, "utf8")).toBe("# Requirements\n\nExport body\n")
	})

	it("rejects empty destination directory", async () => {
		const ws = await seedSpec()
		const plan = await coordinator.plan({
			workspaceRoot: projectRoot,
			selections: [{ specId: ws.id, docId: "requirements" }],
			destinationDirectory: "",
		})
		expect(plan.items).toEqual([])
		expect(plan.skipped[0].reason).toMatch(/destination/i)
	})

	it("revalidates source hash before write", async () => {
		const ws = await seedSpec()
		const plan = await coordinator.plan({
			workspaceRoot: projectRoot,
			selections: [{ specId: ws.id, docId: "requirements" }],
			destinationDirectory: projectRoot,
		})
		const current = await service.getDocument(projectRoot, ws.id, "requirements")
		await service.writeDocument({
			workspaceRoot: projectRoot,
			specId: ws.id,
			docIdOrKind: "requirements",
			content: "# Changed after plan\n",
			expectedRevision: current?.meta.revision,
		})
		const result = await coordinator.commit({ workspaceRoot: projectRoot, items: plan.items })
		expect(result.rollbackAttempted).toBe(true)
		expect(result.results.some((r) => r.status === "failed")).toBe(true)
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("revalidates target hash before overwrite", async () => {
		const ws = await seedSpec()
		const target = path.join(projectRoot, "requirements.md")
		await fs.writeFile(target, "original\n", "utf8")
		const plan = await coordinator.plan({
			workspaceRoot: projectRoot,
			selections: [{ specId: ws.id, docId: "requirements" }],
			destinationDirectory: projectRoot,
		})
		await fs.writeFile(target, "changed after plan\n", "utf8")
		const result = await coordinator.commit({
			workspaceRoot: projectRoot,
			items: plan.items,
			conflictResolutions: { "requirements.md": "overwrite" },
		})
		expect(result.rollbackAttempted).toBe(true)
		expect(await fs.readFile(target, "utf8")).toBe("changed after plan\n")
	})

	it("empty selection commit is a no-op", async () => {
		const plan = await coordinator.plan({
			workspaceRoot: projectRoot,
			selections: [],
			destinationDirectory: projectRoot,
		})
		expect(plan.items).toEqual([])
		const result = await coordinator.commit({ workspaceRoot: projectRoot, items: [] })
		expect(result.results).toEqual([])
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("exports multi-doc package under destination directory", async () => {
		const ws = await seedSpec()
		const dest = path.join(projectRoot, "plans")
		const plan = await coordinator.plan({
			workspaceRoot: projectRoot,
			selections: [
				{ specId: ws.id, docId: "requirements" },
				{ specId: ws.id, docId: "design" },
				{ specId: ws.id, docId: "tasks" },
			],
			destinationDirectory: dest,
		})
		expect(plan.items).toHaveLength(3)
		const result = await coordinator.commit({ workspaceRoot: projectRoot, items: plan.items })
		expect(result.results.every((r) => r.status === "created")).toBe(true)
		const files = await fs.readdir(dest)
		expect(files.sort()).toEqual(["design.md", "requirements.md", "tasks.md"])
	})
})
