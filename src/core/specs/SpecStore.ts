import * as fs from "fs/promises"
import * as path from "path"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { safeWriteJson } from "../../utils/safeWriteJson"
import {
	assertPathInsideBase,
	assertSafeDocFileName,
	assertSafeId,
	getDocFilePath,
	getDocsDirectory,
	getSpecDirectory,
	getWorkspaceSpecsRoot,
} from "./paths"
import type { SpecRevisionEntry, SpecWorkspaceIndex, SpecWorkspaceMeta } from "./types"

/**
 * Low-level disk I/O for virtual specs under extension global storage.
 * Never writes into the user project workspace.
 */
export class SpecStore {
	constructor(private readonly globalStoragePath: string) {}

	async getWorkspaceSpecsRoot(workspaceRootHash: string): Promise<string> {
		return getWorkspaceSpecsRoot(this.globalStoragePath, workspaceRootHash)
	}

	async getSpecDir(workspaceRootHash: string, specId: string): Promise<string> {
		return getSpecDirectory(this.globalStoragePath, workspaceRootHash, specId)
	}

	async readIndex(workspaceRootHash: string): Promise<SpecWorkspaceIndex | null> {
		const root = await this.getWorkspaceSpecsRoot(workspaceRootHash)
		const indexPath = path.join(root, GlobalFileNames.specIndex)
		try {
			const raw = await fs.readFile(indexPath, "utf8")
			const parsed = JSON.parse(raw) as SpecWorkspaceIndex
			if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
				return null
			}
			return parsed
		} catch (error: unknown) {
			if (isNotFound(error)) {
				return null
			}
			throw error
		}
	}

	async writeIndex(workspaceRootHash: string, index: SpecWorkspaceIndex): Promise<void> {
		assertSafeId(workspaceRootHash, "workspaceRootHash")
		const root = await this.getWorkspaceSpecsRoot(workspaceRootHash)
		await fs.mkdir(root, { recursive: true })
		const indexPath = path.join(root, GlobalFileNames.specIndex)
		assertPathInsideBase(root, indexPath)
		await safeWriteJson(indexPath, index)
	}

	async readMeta(workspaceRootHash: string, specId: string): Promise<SpecWorkspaceMeta | null> {
		const specDir = await this.getSpecDir(workspaceRootHash, specId)
		const metaPath = path.join(specDir, GlobalFileNames.specMeta)
		try {
			const raw = await fs.readFile(metaPath, "utf8")
			return JSON.parse(raw) as SpecWorkspaceMeta
		} catch (error: unknown) {
			if (isNotFound(error)) {
				return null
			}
			throw error
		}
	}

	async writeMeta(meta: SpecWorkspaceMeta): Promise<void> {
		assertSafeId(meta.workspaceRootHash, "workspaceRootHash")
		assertSafeId(meta.id, "specId")
		const specDir = await this.getSpecDir(meta.workspaceRootHash, meta.id)
		await fs.mkdir(getDocsDirectory(specDir), { recursive: true })
		const metaPath = path.join(specDir, GlobalFileNames.specMeta)
		assertPathInsideBase(specDir, metaPath)
		await safeWriteJson(metaPath, meta)
	}

	async readDocBody(workspaceRootHash: string, specId: string, fileName: string): Promise<string> {
		const specDir = await this.getSpecDir(workspaceRootHash, specId)
		const filePath = getDocFilePath(specDir, fileName)
		try {
			return await fs.readFile(filePath, "utf8")
		} catch (error: unknown) {
			if (isNotFound(error)) {
				return ""
			}
			throw error
		}
	}

	async writeDocBody(workspaceRootHash: string, specId: string, fileName: string, content: string): Promise<void> {
		assertSafeDocFileName(fileName)
		const specDir = await this.getSpecDir(workspaceRootHash, specId)
		const docsDir = getDocsDirectory(specDir)
		await fs.mkdir(docsDir, { recursive: true })
		const filePath = getDocFilePath(specDir, fileName)
		// Atomic-ish write: temp file then rename
		const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
		assertPathInsideBase(docsDir, tmpPath)
		await fs.writeFile(tmpPath, content, "utf8")
		await fs.rename(tmpPath, filePath)
	}

	private async getHistoryDir(workspaceRootHash: string, specId: string, docId: string): Promise<string> {
		assertSafeId(docId, "docId")
		const specDir = await this.getSpecDir(workspaceRootHash, specId)
		const historyRoot = path.join(specDir, "history")
		const historyDir = path.join(historyRoot, docId)
		assertPathInsideBase(specDir, historyRoot)
		assertPathInsideBase(historyRoot, historyDir)
		return historyDir
	}

	async readHistoryIndex(workspaceRootHash: string, specId: string, docId: string): Promise<SpecRevisionEntry[]> {
		const historyDir = await this.getHistoryDir(workspaceRootHash, specId, docId)
		const indexPath = path.join(historyDir, "index.json")
		assertPathInsideBase(historyDir, indexPath)
		try {
			const raw = await fs.readFile(indexPath, "utf8")
			const parsed = JSON.parse(raw)
			return Array.isArray(parsed) ? (parsed as SpecRevisionEntry[]) : []
		} catch (error: unknown) {
			if (isNotFound(error)) return []
			throw error
		}
	}

	async writeHistoryIndex(
		workspaceRootHash: string,
		specId: string,
		docId: string,
		entries: SpecRevisionEntry[],
	): Promise<void> {
		const historyDir = await this.getHistoryDir(workspaceRootHash, specId, docId)
		await fs.mkdir(historyDir, { recursive: true })
		const indexPath = path.join(historyDir, "index.json")
		assertPathInsideBase(historyDir, indexPath)
		await safeWriteJson(indexPath, entries, { prettyPrint: true })
	}

	async readRevisionSnapshot(
		workspaceRootHash: string,
		specId: string,
		docId: string,
		revision: number,
	): Promise<string | null> {
		if (!Number.isInteger(revision) || revision < 1) throw new Error(`Invalid revision: ${revision}`)
		const historyDir = await this.getHistoryDir(workspaceRootHash, specId, docId)
		const snapshotPath = path.join(historyDir, `${revision}.md`)
		assertPathInsideBase(historyDir, snapshotPath)
		try {
			return await fs.readFile(snapshotPath, "utf8")
		} catch (error: unknown) {
			if (isNotFound(error)) return null
			throw error
		}
	}

	async writeRevisionSnapshot(
		workspaceRootHash: string,
		specId: string,
		docId: string,
		revision: number,
		content: string,
	): Promise<void> {
		if (!Number.isInteger(revision) || revision < 1) throw new Error(`Invalid revision: ${revision}`)
		const historyDir = await this.getHistoryDir(workspaceRootHash, specId, docId)
		await fs.mkdir(historyDir, { recursive: true })
		const snapshotPath = path.join(historyDir, `${revision}.md`)
		assertPathInsideBase(historyDir, snapshotPath)
		const tmpPath = `${snapshotPath}.${process.pid}.${Date.now()}.tmp`
		assertPathInsideBase(historyDir, tmpPath)
		await fs.writeFile(tmpPath, content, "utf8")
		await fs.rename(tmpPath, snapshotPath)
	}

	async deleteRevisionSnapshot(
		workspaceRootHash: string,
		specId: string,
		docId: string,
		revision: number,
	): Promise<void> {
		const historyDir = await this.getHistoryDir(workspaceRootHash, specId, docId)
		const snapshotPath = path.join(historyDir, `${revision}.md`)
		assertPathInsideBase(historyDir, snapshotPath)
		await fs.rm(snapshotPath, { force: true })
	}

	async deleteSpecDir(workspaceRootHash: string, specId: string): Promise<void> {
		const specDir = await this.getSpecDir(workspaceRootHash, specId)
		const root = await this.getWorkspaceSpecsRoot(workspaceRootHash)
		assertPathInsideBase(root, specDir)
		await fs.rm(specDir, { recursive: true, force: true })
	}

	/**
	 * Rebuild index by scanning each spec folder meta.json when index is missing or corrupt.
	 */
	async rebuildIndex(workspaceRootHash: string): Promise<SpecWorkspaceIndex> {
		const root = await this.getWorkspaceSpecsRoot(workspaceRootHash)
		const index: SpecWorkspaceIndex = {
			version: 1,
			workspaceRootHash,
			updatedAt: Date.now(),
			entries: [],
		}

		let dirents: Array<{ name: string; isDirectory: () => boolean }>
		try {
			dirents = await fs.readdir(root, { withFileTypes: true })
		} catch (error: unknown) {
			if (isNotFound(error)) {
				return index
			}
			throw error
		}

		for (const dirent of dirents) {
			if (!dirent.isDirectory()) {
				continue
			}
			const name = String(dirent.name)
			const meta = await this.readMeta(workspaceRootHash, name)
			if (!meta) {
				continue
			}
			index.entries.push({
				id: meta.id,
				title: meta.title,
				stage: meta.stage,
				updatedAt: meta.updatedAt,
			})
		}

		index.entries.sort((a, b) => b.updatedAt - a.updatedAt)
		index.updatedAt = Date.now()
		await this.writeIndex(workspaceRootHash, index)
		return index
	}
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	)
}
