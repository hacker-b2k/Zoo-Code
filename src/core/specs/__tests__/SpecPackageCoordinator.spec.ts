import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { SpecService } from "../SpecService"
import { SpecPackageCoordinator } from "../package/SpecPackageCoordinator"
import { hashSpecPackageContent, serializeSpecPackage } from "../package/specPackageCodec"
import { SPEC_PACKAGE_FORMAT, SPEC_PACKAGE_VERSION, type SpecPackage } from "../package/specPackageTypes"

describe("F-023 Combined Spec Package coordinator", () => {
	let globalStorage: string
	let projectRoot: string
	let service: SpecService
	let coordinator: SpecPackageCoordinator

	beforeEach(async () => {
		globalStorage = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-pkg-global-"))
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-pkg-project-"))
		service = new SpecService(globalStorage)
		coordinator = new SpecPackageCoordinator(service)
	})

	afterEach(async () => {
		await fs.rm(globalStorage, { recursive: true, force: true })
		await fs.rm(projectRoot, { recursive: true, force: true })
	})

	async function seedWorkspace(): Promise<{ id: string }> {
		const workspace = await service.createWorkspace({ title: "Auth System", workspaceRoot: projectRoot })
		await service.writeDocument({
			specId: workspace.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "requirements",
			content: "# Requirements\n\nAuth flows\n",
		})
		await service.writeDocument({
			specId: workspace.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "design",
			content: "# Design\n\nSequence diagram\n",
		})
		await service.writeDocument({
			specId: workspace.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "tasks",
			content: "# Tasks\n\n- [ ] login\n",
		})
		return { id: workspace.id }
	}

	function buildPackage(
		documents: Array<{ id: string; kind: string; title: string; content: string }>,
		specId = "trace-123",
	): SpecPackage {
		const now = Date.now()
		const docs = documents.map((d) => ({
			id: d.id,
			kind: d.kind,
			title: d.title,
			fileName: `${d.id}.md`,
			revision: 1,
			createdAt: now - 1000,
			updatedAt: now - 500,
			content: d.content,
			contentHash: hashSpecPackageContent(d.content),
		}))
		const pkg: Omit<SpecPackage, "packageHash"> = {
			format: SPEC_PACKAGE_FORMAT,
			formatVersion: SPEC_PACKAGE_VERSION,
			exportedAt: now,
			exporter: "zoo-code",
			source: {
				specId,
				title: "Imported Pack",
				stage: "tasks",
				createdAt: now - 1000,
				updatedAt: now - 500,
				schemaVersion: 1,
			},
			documents: docs,
		}
		const serialized = serializeSpecPackage(pkg)
		return JSON.parse(serialized) as SpecPackage
	}

	async function writePackageOnDisk(pkg: SpecPackage, filePath: string): Promise<void> {
		const { packageHash: _omit, ...rest } = pkg
		await fs.writeFile(filePath, serializeSpecPackage(rest), "utf8")
	}

	describe("export", () => {
		it("planExport builds package with selected docs and metadata", async () => {
			const { id } = await seedWorkspace()
			const dest = path.join(globalStorage, "out.zspec")
			const plan = await coordinator.planExport({ workspaceRoot: projectRoot, specId: id, docIds: [] }, dest)
			expect(plan.pkg.documents).toHaveLength(3)
			expect(plan.pkg.source.title).toBe("Auth System")
			expect(plan.byteLength).toBeGreaterThan(0)
			expect(plan.targetExists).toBe(false)
			expect(plan.specId).toBe(id)
		})

		it("planExport respects doc subset", async () => {
			const { id } = await seedWorkspace()
			const dest = path.join(globalStorage, "out.zspec")
			const plan = await coordinator.planExport(
				{ workspaceRoot: projectRoot, specId: id, docIds: ["design", "tasks"] },
				dest,
			)
			expect(plan.pkg.documents).toHaveLength(2)
			expect(plan.pkg.documents.map((d) => d.kind)).toEqual(["design", "tasks"])
		})

		it("planExport detects existing target", async () => {
			const { id } = await seedWorkspace()
			const dest = path.join(globalStorage, "out.zspec")
			await fs.writeFile(dest, "placeholder\n", "utf8")
			const plan = await coordinator.planExport({ workspaceRoot: projectRoot, specId: id, docIds: [] }, dest)
			expect(plan.targetExists).toBe(true)
		})

		it("commitExport creates a new .zspec on disk", async () => {
			const { id } = await seedWorkspace()
			const dest = path.join(globalStorage, "out.zspec")
			const plan = await coordinator.planExport({ workspaceRoot: projectRoot, specId: id, docIds: [] }, dest)
			const result = await coordinator.commitExport({ plan })
			expect(result.status).toBe("created")
			expect(result.path).toBe(dest)
			const written = await fs.readFile(dest, "utf8")
			expect(JSON.parse(written).format).toBe(SPEC_PACKAGE_FORMAT)
		})

		it("commitExport overwrites when conflictAction overwrite", async () => {
			const { id } = await seedWorkspace()
			const dest = path.join(globalStorage, "out.zspec")
			await fs.writeFile(dest, "old\n", "utf8")
			const plan = await coordinator.planExport({ workspaceRoot: projectRoot, specId: id, docIds: [] }, dest)
			const result = await coordinator.commitExport({ plan, conflictAction: "overwrite" })
			expect(result.status).toBe("overwritten")
			const written = await fs.readFile(dest, "utf8")
			expect(JSON.parse(written).format).toBe(SPEC_PACKAGE_FORMAT)
		})

		it("commitExport skips when target exists and no overwrite", async () => {
			const { id } = await seedWorkspace()
			const dest = path.join(globalStorage, "out.zspec")
			await fs.writeFile(dest, "untouched\n", "utf8")
			const plan = await coordinator.planExport({ workspaceRoot: projectRoot, specId: id, docIds: [] }, dest)
			const result = await coordinator.commitExport({ plan })
			expect(result.status).toBe("skipped")
			const written = await fs.readFile(dest, "utf8")
			expect(written).toBe("untouched\n")
		})

		it("export does not mutate virtual storage", async () => {
			const { id } = await seedWorkspace()
			const dest = path.join(globalStorage, "out.zspec")
			const plan = await coordinator.planExport({ workspaceRoot: projectRoot, specId: id, docIds: [] }, dest)
			await coordinator.commitExport({ plan })
			const workspace = await service.getWorkspace(projectRoot, id)
			expect(workspace?.docs).toHaveLength(3)
			const req = await service.getDocument(projectRoot, id, "requirements")
			expect(req?.content).toBe("# Requirements\n\nAuth flows\n")
			// Project root stays clean (export went to globalStorage, not projectRoot)
			expect(await fs.readdir(projectRoot)).toEqual([])
		})
	})

	describe("import", () => {
		it("planImport reads a .zspec and maps documents", async () => {
			const pkg = buildPackage([
				{ id: "requirements", kind: "requirements", title: "Requirements", content: "# Req\n" },
				{ id: "design", kind: "design", title: "Design", content: "# Design\n" },
				{ id: "tasks", kind: "tasks", title: "Tasks", content: "# Tasks\n" },
			])
			const filePath = path.join(globalStorage, "pkg.zspec")
			await writePackageOnDisk(pkg, filePath)
			const plan = await coordinator.planImport(projectRoot, filePath)
			expect(plan.documents).toHaveLength(3)
			expect(plan.proposedTitle).toBe("Imported Pack")
			expect(plan.proposedStage).toBe("tasks")
			for (const doc of plan.documents) {
				expect(doc.byteLength).toBeGreaterThan(0)
				expect(doc.contentHash).toMatch(/^[a-f0-9]{64}$/)
			}
		})

		it("planImport maps unknown kinds to custom with safe ids", async () => {
			const pkg = buildPackage([
				{ id: "roadmap", kind: "roadmap", title: "Roadmap", content: "# Roadmap\n" },
				{ id: "requirements", kind: "requirements", title: "Requirements", content: "# Req\n" },
			])
			const filePath = path.join(globalStorage, "pkg.zspec")
			await writePackageOnDisk(pkg, filePath)
			const plan = await coordinator.planImport(projectRoot, filePath)
			expect(plan.documents[0].kind).toBe("custom")
			expect(plan.documents[0].id).toBe("custom-1")
			expect(plan.documents[1].kind).toBe("requirements")
			expect(plan.documents[1].id).toBe("requirements")
		})

		it("commitImport creates a new virtual pack with all docs", async () => {
			const pkg = buildPackage([
				{ id: "requirements", kind: "requirements", title: "Requirements", content: "# Req\n" },
				{ id: "design", kind: "design", title: "Design", content: "# Design\n" },
				{ id: "tasks", kind: "tasks", title: "Tasks", content: "# Tasks\n" },
			])
			const filePath = path.join(globalStorage, "pkg.zspec")
			await writePackageOnDisk(pkg, filePath)
			const result = await coordinator.commitImport({ workspaceRoot: projectRoot, packagePath: filePath })
			expect(result.docs).toHaveLength(3)
			const byKind = new Map(result.docs.map((d) => [d.kind, d]))
			// docs are metadata-only; fetch bodies from virtual storage
			const reqDoc = await service.getDocument(projectRoot, result.id, byKind.get("requirements")!.id)
			const designDoc = await service.getDocument(projectRoot, result.id, byKind.get("design")!.id)
			const tasksDoc = await service.getDocument(projectRoot, result.id, byKind.get("tasks")!.id)
			expect(reqDoc?.content).toBe("# Req\n")
			expect(designDoc?.content).toBe("# Design\n")
			expect(tasksDoc?.content).toBe("# Tasks\n")
			// Persisted in virtual storage
			const stored = await service.getWorkspace(projectRoot, result.id)
			expect(stored?.docs).toHaveLength(3)
		})

		it("commitImport always creates a NEW pack id (never reuses source.specId)", async () => {
			const pkg = buildPackage(
				[{ id: "requirements", kind: "requirements", title: "Requirements", content: "# Req\n" }],
				"trace-123",
			)
			const filePath = path.join(globalStorage, "pkg.zspec")
			await writePackageOnDisk(pkg, filePath)
			const result = await coordinator.commitImport({ workspaceRoot: projectRoot, packagePath: filePath })
			expect(result.id).not.toBe("trace-123")
		})

		it("commitImport selects subset by documentIds", async () => {
			const pkg = buildPackage([
				{ id: "requirements", kind: "requirements", title: "Requirements", content: "# Req\n" },
				{ id: "design", kind: "design", title: "Design", content: "# Design\n" },
				{ id: "tasks", kind: "tasks", title: "Tasks", content: "# Tasks\n" },
			])
			const filePath = path.join(globalStorage, "pkg.zspec")
			await writePackageOnDisk(pkg, filePath)
			const result = await coordinator.commitImport({
				workspaceRoot: projectRoot,
				packagePath: filePath,
				documentIds: ["design"],
			})
			expect(result.docs).toHaveLength(1)
			expect(result.docs[0].kind).toBe("design")
		})

		it("commitImport does not modify the source .zspec file", async () => {
			const pkg = buildPackage([
				{ id: "requirements", kind: "requirements", title: "Requirements", content: "# Req\n" },
			])
			const filePath = path.join(globalStorage, "pkg.zspec")
			await writePackageOnDisk(pkg, filePath)
			const before = await fs.readFile(filePath, "utf8")
			await coordinator.commitImport({ workspaceRoot: projectRoot, packagePath: filePath })
			const after = await fs.readFile(filePath, "utf8")
			expect(after).toBe(before)
		})

		it("commitImport rejects corrupted package", async () => {
			const filePath = path.join(globalStorage, "bad.zspec")
			await fs.writeFile(filePath, "{not valid json", "utf8")
			await expect(
				coordinator.commitImport({ workspaceRoot: projectRoot, packagePath: filePath }),
			).rejects.toThrow()
		})
	})

	describe("round-trip (export then import)", () => {
		it("round-trips titles/kinds/bodies", async () => {
			const { id } = await seedWorkspace()
			const dest = path.join(globalStorage, "round-trip.zspec")
			const plan = await coordinator.planExport({ workspaceRoot: projectRoot, specId: id, docIds: [] }, dest)
			await coordinator.commitExport({ plan })

			const imported = await coordinator.commitImport({
				workspaceRoot: projectRoot,
				packagePath: dest,
			})
			expect(imported.id).not.toBe(id)
			expect(imported.docs).toHaveLength(3)
			const byKind = new Map(imported.docs.map((d) => [d.kind, d]))
			// docs are metadata-only; fetch bodies from virtual storage
			const reqDoc = await service.getDocument(projectRoot, imported.id, byKind.get("requirements")!.id)
			const designDoc = await service.getDocument(projectRoot, imported.id, byKind.get("design")!.id)
			const tasksDoc = await service.getDocument(projectRoot, imported.id, byKind.get("tasks")!.id)
			expect(reqDoc?.content).toBe("# Requirements\n\nAuth flows\n")
			expect(designDoc?.content).toBe("# Design\n\nSequence diagram\n")
			expect(tasksDoc?.content).toBe("# Tasks\n\n- [ ] login\n")
			expect(byKind.get("requirements")?.title).toBe("Requirements")
			expect(byKind.get("design")?.title).toBe("Design")
			// tasks starter doc title is "Task list" (STARTER_SPEC_DOCS default)
			expect(byKind.get("tasks")?.title).toBe("Task list")
		})
	})

	describe("project pollution guard", () => {
		it("import leaves project root clean (virtual storage only)", async () => {
			const siblingDir = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-pkg-sibling-"))
			try {
				const pkg = buildPackage([
					{ id: "requirements", kind: "requirements", title: "Requirements", content: "# Req\n" },
				])
				const filePath = path.join(siblingDir, "pkg.zspec")
				await writePackageOnDisk(pkg, filePath)
				await coordinator.commitImport({ workspaceRoot: projectRoot, packagePath: filePath })
				expect(await fs.readdir(projectRoot)).toEqual([])
			} finally {
				await fs.rm(siblingDir, { recursive: true, force: true })
			}
		})
	})
})
