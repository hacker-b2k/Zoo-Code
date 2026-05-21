import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockWorkspace = vi.hoisted(() => ({
	workspaceFolders: [] as Array<{ uri: { fsPath: string }; name: string; index: number }>,
}))

vi.mock("vscode", () => ({
	workspace: mockWorkspace,
}))

import {
	getWorkspaceReadablePath,
	getWorkspaceRelativePath,
	getWorkspaceRootForPath,
	resolvePathInWorkspace,
} from "../pathUtils"

describe("pathUtils", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-path-utils-"))
	})

	afterEach(async () => {
		mockWorkspace.workspaceFolders = []
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("resolves a relative path from a secondary workspace root when it does not exist in cwd", async () => {
		const primaryRoot = path.join(tempDir, "primary")
		const secondaryRoot = path.join(tempDir, "secondary")
		await fs.mkdir(primaryRoot, { recursive: true })
		await fs.mkdir(secondaryRoot, { recursive: true })
		await fs.writeFile(path.join(secondaryRoot, "only-secondary.txt"), "secondary", "utf8")

		mockWorkspace.workspaceFolders = [
			{ uri: { fsPath: primaryRoot }, name: "primary", index: 0 },
			{ uri: { fsPath: secondaryRoot }, name: "secondary", index: 1 },
		]

		await expect(resolvePathInWorkspace(primaryRoot, "only-secondary.txt")).resolves.toBe(
			path.join(secondaryRoot, "only-secondary.txt"),
		)
	})

	it("returns absolute paths unchanged", async () => {
		const absolutePath = path.join(tempDir, "absolute.txt")
		await expect(resolvePathInWorkspace(path.join(tempDir, "cwd"), absolutePath)).resolves.toBe(absolutePath)
	})

	it("prefers the cwd path when the file already exists there", async () => {
		const primaryRoot = path.join(tempDir, "primary")
		const secondaryRoot = path.join(tempDir, "secondary")
		const fileName = "shared.txt"

		await fs.mkdir(primaryRoot, { recursive: true })
		await fs.mkdir(secondaryRoot, { recursive: true })
		await fs.writeFile(path.join(primaryRoot, fileName), "primary", "utf8")
		await fs.writeFile(path.join(secondaryRoot, fileName), "secondary", "utf8")

		mockWorkspace.workspaceFolders = [
			{ uri: { fsPath: primaryRoot }, name: "primary", index: 0 },
			{ uri: { fsPath: secondaryRoot }, name: "secondary", index: 1 },
		]

		await expect(resolvePathInWorkspace(primaryRoot, fileName)).resolves.toBe(path.join(primaryRoot, fileName))
	})

	it("supports workspace-folder-name-prefixed paths before the file exists", async () => {
		const primaryRoot = path.join(tempDir, "primary")
		const secondaryRoot = path.join(tempDir, "secondary")
		await fs.mkdir(primaryRoot, { recursive: true })
		await fs.mkdir(secondaryRoot, { recursive: true })

		mockWorkspace.workspaceFolders = [
			{ uri: { fsPath: primaryRoot }, name: "primary", index: 0 },
			{ uri: { fsPath: secondaryRoot }, name: "secondary", index: 1 },
		]

		await expect(resolvePathInWorkspace(primaryRoot, path.join("secondary", "new-file.txt"))).resolves.toBe(
			path.join(secondaryRoot, "new-file.txt"),
		)
	})

	it("resolves a new file into the only workspace root that already contains the parent directory", async () => {
		const primaryRoot = path.join(tempDir, "primary")
		const secondaryRoot = path.join(tempDir, "secondary")
		await fs.mkdir(path.join(primaryRoot, "src"), { recursive: true })
		await fs.mkdir(path.join(secondaryRoot, "nested", "dir"), { recursive: true })

		mockWorkspace.workspaceFolders = [
			{ uri: { fsPath: primaryRoot }, name: "primary", index: 0 },
			{ uri: { fsPath: secondaryRoot }, name: "secondary", index: 1 },
		]

		await expect(resolvePathInWorkspace(primaryRoot, path.join("nested", "dir", "new-file.txt"))).resolves.toBe(
			path.join(secondaryRoot, "nested", "dir", "new-file.txt"),
		)
	})

	it("does not allow workspace-folder-name prefixes to escape the selected root", async () => {
		const primaryRoot = path.join(tempDir, "primary")
		const secondaryRoot = path.join(tempDir, "secondary")
		await fs.mkdir(primaryRoot, { recursive: true })
		await fs.mkdir(secondaryRoot, { recursive: true })

		mockWorkspace.workspaceFolders = [
			{ uri: { fsPath: primaryRoot }, name: "primary", index: 0 },
			{ uri: { fsPath: secondaryRoot }, name: "secondary", index: 1 },
		]

		await expect(resolvePathInWorkspace(primaryRoot, path.join("secondary", "..", "escaped.txt"))).resolves.toBe(
			path.join(primaryRoot, "escaped.txt"),
		)
	})

	it("prefers the cwd-owned parent match when multiple roots contain the parent directory", async () => {
		const primaryRoot = path.join(tempDir, "primary")
		const secondaryRoot = path.join(tempDir, "secondary")
		const filePath = path.join("nested", "new-file.txt")

		await fs.mkdir(path.join(primaryRoot, "nested"), { recursive: true })
		await fs.mkdir(path.join(secondaryRoot, "nested"), { recursive: true })

		mockWorkspace.workspaceFolders = [
			{ uri: { fsPath: primaryRoot }, name: "primary", index: 0 },
			{ uri: { fsPath: secondaryRoot }, name: "secondary", index: 1 },
		]

		await expect(resolvePathInWorkspace(primaryRoot, filePath)).resolves.toBe(path.join(primaryRoot, filePath))
	})

	it("falls back to the primary cwd path when parent matches are ambiguous", async () => {
		const firstRoot = path.join(tempDir, "first")
		const secondRoot = path.join(tempDir, "second")
		const externalCwd = path.join(tempDir, "external")
		const filePath = path.join("nested", "new-file.txt")

		await fs.mkdir(path.join(firstRoot, "nested"), { recursive: true })
		await fs.mkdir(path.join(secondRoot, "nested"), { recursive: true })
		await fs.mkdir(externalCwd, { recursive: true })

		mockWorkspace.workspaceFolders = [
			{ uri: { fsPath: firstRoot }, name: "first", index: 0 },
			{ uri: { fsPath: secondRoot }, name: "second", index: 1 },
		]

		await expect(resolvePathInWorkspace(externalCwd, filePath)).resolves.toBe(path.join(externalCwd, filePath))
	})

	it("returns the matching workspace root or fallback cwd for an absolute path", () => {
		const primaryRoot = path.join(tempDir, "primary")
		const secondaryRoot = path.join(tempDir, "secondary")
		const fallbackRoot = path.join(tempDir, "fallback")

		mockWorkspace.workspaceFolders = [
			{ uri: { fsPath: primaryRoot }, name: "primary", index: 0 },
			{ uri: { fsPath: secondaryRoot }, name: "secondary", index: 1 },
		]

		expect(getWorkspaceRootForPath(path.join(secondaryRoot, "nested", "file.txt"), fallbackRoot)).toBe(
			secondaryRoot,
		)
		expect(getWorkspaceRootForPath(path.join(fallbackRoot, "nested", "file.txt"), fallbackRoot)).toBe(fallbackRoot)
		expect(getWorkspaceRootForPath(path.join(tempDir, "outside", "file.txt"), fallbackRoot)).toBeUndefined()
	})

	it("returns workspace-relative paths for absolute files", () => {
		const primaryRoot = path.join(tempDir, "primary")
		const secondaryRoot = path.join(tempDir, "secondary")

		mockWorkspace.workspaceFolders = [
			{ uri: { fsPath: primaryRoot }, name: "primary", index: 0 },
			{ uri: { fsPath: secondaryRoot }, name: "secondary", index: 1 },
		]

		expect(getWorkspaceRelativePath(primaryRoot, path.join(secondaryRoot, "nested", "file.txt"))).toBe(
			"nested/file.txt",
		)
	})

	it("returns workspace-folder-qualified display paths in multi-root workspaces", () => {
		const primaryRoot = path.join(tempDir, "primary")
		const secondaryRoot = path.join(tempDir, "secondary")

		mockWorkspace.workspaceFolders = [
			{ uri: { fsPath: primaryRoot }, name: "primary", index: 0 },
			{ uri: { fsPath: secondaryRoot }, name: "secondary", index: 1 },
		]

		expect(getWorkspaceReadablePath(primaryRoot, path.join(secondaryRoot, "nested", "file.txt"), "file.txt")).toBe(
			"secondary/nested/file.txt",
		)
	})

	it("returns the root name when the absolute path points at a workspace root", () => {
		const primaryRoot = path.join(tempDir, "primary")
		const secondaryRoot = path.join(tempDir, "secondary")

		mockWorkspace.workspaceFolders = [
			{ uri: { fsPath: primaryRoot }, name: "primary", index: 0 },
			{ uri: { fsPath: secondaryRoot }, name: "secondary", index: 1 },
		]

		expect(getWorkspaceReadablePath(primaryRoot, secondaryRoot, "secondary")).toBe("secondary")
	})

	it("falls back to cwd-readable paths when the file is outside known workspace roots", () => {
		const cwd = path.join(tempDir, "cwd")
		const outsidePath = path.join(tempDir, "outside", "file.txt")

		expect(getWorkspaceReadablePath(cwd, outsidePath, "outside/file.txt")).toBe("outside/file.txt")
	})
})
