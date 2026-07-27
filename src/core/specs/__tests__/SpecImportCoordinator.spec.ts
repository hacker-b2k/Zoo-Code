import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { SpecImportCoordinator } from "../import/SpecImportCoordinator"
import { SpecService } from "../SpecService"

describe("F-011 Import Existing Plans", () => {
	let globalStorage: string
	let projectRoot: string
	let service: SpecService
	let coordinator: SpecImportCoordinator

	beforeEach(async () => {
		globalStorage = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-import-global-"))
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-import-project-"))
		service = new SpecService(globalStorage)
		coordinator = new SpecImportCoordinator(service)
	})

	afterEach(async () => {
		await fs.rm(globalStorage, { recursive: true, force: true })
		await fs.rm(projectRoot, { recursive: true, force: true })
	})

	async function source(name: string, content: string): Promise<string> {
		const target = path.join(projectRoot, "plans", name)
		await fs.mkdir(path.dirname(target), { recursive: true })
		await fs.writeFile(target, content, "utf8")
		return target
	}

	it("plans selected markdown with deterministic kind/title mapping", async () => {
		const requirements = await source("requirements.md", "# Checkout Requirements\n\nBody\n")
		const design = await source("architecture.md", "# Checkout Architecture\n")
		const tasks = await source("implementation-plan.md", "# Checkout Plan\n")
		const plan = await coordinator.planSelectedFiles(projectRoot, [requirements, design, tasks])
		expect(plan.skipped).toEqual([])
		expect(plan.candidates.map((item) => item.proposedKind)).toEqual(["requirements", "design", "tasks"])
		expect(plan.candidates[0].proposedTitle).toBe("Checkout Requirements")
	})

	it("skips non-markdown but accepts outside-workspace markdown (import anywhere)", async () => {
		const text = await source("notes.txt", "no")
		const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-import-outside-"))
		try {
			const outside = path.join(outsideDir, "architecture-design.md")
			await fs.writeFile(outside, "# Outside Design\n")
			const plan = await coordinator.planSelectedFiles(projectRoot, [text, outside])
			expect(plan.skipped.map((item) => item.reason)).toEqual(["not markdown"])
			expect(plan.candidates).toHaveLength(1)
			expect(plan.candidates[0].proposedKind).toBe("design")
			expect(plan.candidates[0].relativePath).toBe("architecture-design.md")
			const created = await coordinator.commit({ workspaceRoot: projectRoot, candidates: plan.candidates })
			expect(created).toHaveLength(1)
			expect(await fs.readFile(outside, "utf8")).toBe("# Outside Design\n")
		} finally {
			await fs.rm(outsideDir, { recursive: true, force: true })
		}
	})

	it("skips files above the per-file limit", async () => {
		const large = await source("large.md", "x".repeat(1024 * 1024 + 1))
		const plan = await coordinator.planSelectedFiles(projectRoot, [large])
		expect(plan.candidates).toEqual([])
		expect(plan.skipped[0].reason).toMatch(/size/i)
	})

	it("revalidates source hashes before commit", async () => {
		const file = await source("design.md", "# Before\n")
		const plan = await coordinator.planSelectedFiles(projectRoot, [file])
		await fs.writeFile(file, "# After\n", "utf8")
		await expect(coordinator.commit({ workspaceRoot: projectRoot, candidates: plan.candidates })).rejects.toThrow(
			/source changed/i,
		)
		expect(await service.listWorkspaces(projectRoot)).toEqual([])
	})

	it("imports into virtual storage without modifying originals", async () => {
		const file = await source("api-design.md", "# Public API\n\nOriginal bytes\n")
		const before = await fs.readFile(file)
		const plan = await coordinator.planSelectedFiles(projectRoot, [file])
		const created = await coordinator.commit({ workspaceRoot: projectRoot, candidates: plan.candidates })
		expect(created).toHaveLength(1)
		const doc = await service.getDocument(projectRoot, created[0].id, "design")
		expect(doc?.content).toBe("# Public API\n\nOriginal bytes\n")
		expect(await fs.readFile(file)).toEqual(before)
		const projectFiles = await fs.readdir(path.join(projectRoot, "plans"))
		expect(projectFiles).toEqual(["api-design.md"])
	})

	it("an empty/cancelled selection makes no mutations", async () => {
		const plan = await coordinator.planSelectedFiles(projectRoot, [])
		expect(plan.candidates).toEqual([])
		expect(await coordinator.commit({ workspaceRoot: projectRoot, candidates: [] })).toEqual([])
		expect(await service.listWorkspaces(projectRoot)).toEqual([])
		expect(await fs.readdir(projectRoot)).toEqual([])
	})
})
