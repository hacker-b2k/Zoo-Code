import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { SpecStore } from "../SpecStore"
import { GlobalFileNames } from "../../../shared/globalFileNames"
import type { SpecWorkspaceMeta } from "../types"

describe("SpecStore", () => {
	let tmpBase: string
	let store: SpecStore
	const workspaceHash = "abc123def4567890"
	const specId = "11111111-2222-3333-4444-555555555555"

	beforeEach(async () => {
		tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-store-"))
		store = new SpecStore(tmpBase)
	})

	afterEach(async () => {
		await fs.rm(tmpBase, { recursive: true, force: true })
	})

	function sampleMeta(overrides: Partial<SpecWorkspaceMeta> = {}): SpecWorkspaceMeta {
		const now = Date.now()
		return {
			id: specId,
			title: "Test Spec",
			workspaceRootHash: workspaceHash,
			workspaceRoot: "/tmp/fake-project",
			stage: "requirements",
			docs: [
				{
					id: "requirements",
					kind: "requirements",
					title: "Requirements",
					fileName: "requirements.md",
					revision: 1,
					createdAt: now,
					updatedAt: now,
				},
			],
			taskIds: [],
			createdAt: now,
			updatedAt: now,
			schemaVersion: 1,
			...overrides,
		}
	}

	it("round-trips meta and markdown body under global storage only", async () => {
		const meta = sampleMeta()
		await store.writeMeta(meta)
		await store.writeDocBody(workspaceHash, specId, "requirements.md", "# Hello\n")

		const read = await store.readMeta(workspaceHash, specId)
		expect(read?.title).toBe("Test Spec")
		expect(await store.readDocBody(workspaceHash, specId, "requirements.md")).toBe("# Hello\n")

		const expectedDir = path.join(tmpBase, "specs", workspaceHash, specId)
		const stat = await fs.stat(expectedDir)
		expect(stat.isDirectory()).toBe(true)
		await expect(fs.access(path.join(expectedDir, GlobalFileNames.specMeta))).resolves.toBeUndefined()
	})

	it("returns null for missing meta and empty string for missing body", async () => {
		expect(await store.readMeta(workspaceHash, specId)).toBeNull()
		expect(await store.readDocBody(workspaceHash, specId, "requirements.md")).toBe("")
	})

	it("writes and reads index", async () => {
		await store.writeIndex(workspaceHash, {
			version: 1,
			workspaceRootHash: workspaceHash,
			updatedAt: 1,
			entries: [{ id: specId, title: "T", stage: "design", updatedAt: 1 }],
		})
		const index = await store.readIndex(workspaceHash)
		expect(index?.entries).toHaveLength(1)
		expect(index?.entries[0].title).toBe("T")
	})

	it("deletes spec directory", async () => {
		await store.writeMeta(sampleMeta())
		await store.deleteSpecDir(workspaceHash, specId)
		expect(await store.readMeta(workspaceHash, specId)).toBeNull()
	})

	it("rebuilds index from meta files", async () => {
		await store.writeMeta(sampleMeta({ title: "A" }))
		const index = await store.rebuildIndex(workspaceHash)
		expect(index.entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: specId, title: "A" })]))
	})

	it("never places files outside the specs root under global storage", async () => {
		await store.writeMeta(sampleMeta())
		const entries = await fs.readdir(tmpBase)
		expect(entries).toEqual(["specs"])
	})
})
