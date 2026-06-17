import type { Dirent } from "fs"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { Package } from "../../shared/package"
import { getStorageBasePath } from "../../utils/storage"

const ROO_EXTENSION_DOMAIN = "RooVeterinaryInc.roo-cline"
const ROO_STORAGE_DIRECTORY = ROO_EXTENSION_DOMAIN.toLowerCase()
const ROO_CONFIGURATION_SECTION = "roo-cline"
const IMPORTABLE_TASK_FILE_NAMES = [
	GlobalFileNames.historyItem,
	GlobalFileNames.uiMessages,
	GlobalFileNames.apiConversationHistory,
	GlobalFileNames.taskMetadata,
]

export interface RooHistoryImportPaths {
	rooExtensionDomain: string
	zooExtensionDomain: string
	rooStorageRoots: string[]
	zooStorageRoot: string
}

export interface RooHistoryImportResult extends RooHistoryImportPaths {
	foundTaskCount: number
	importedTaskCount: number
	importedFileCount: number
}

export interface RooHistoryImportProgress {
	copiedFileCount: number
	totalFileCount: number
	importedTaskCount: number
	totalTaskCount: number
	currentTaskId?: string
	currentFileName?: string
}

interface ImportableTaskPlan {
	taskId: string
	sourceTaskDirectory: string
	fileNames: string[]
}

const toComparablePath = (candidatePath: string) => {
	const resolvedPath = path.resolve(candidatePath)
	return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath
}

const dedupePaths = (paths: string[]) => {
	const seen = new Set<string>()
	return paths.filter((candidatePath) => {
		const comparablePath = toComparablePath(candidatePath)
		if (seen.has(comparablePath)) {
			return false
		}
		seen.add(comparablePath)
		return true
	})
}

const getConfiguredCustomStoragePath = (configurationSection: string) => {
	try {
		const configuredPath = vscode.workspace
			.getConfiguration(configurationSection)
			.get<string>("customStoragePath", "")
			.trim()
		return configuredPath || undefined
	} catch {
		return undefined
	}
}

const isSkippableImportError = (error: unknown) => {
	const nodeError = error as NodeJS.ErrnoException
	return nodeError.code === "ENOENT" || nodeError.code === "EACCES" || nodeError.code === "EPERM"
}

const copyTaskFileIfPresent = async (
	sourceTaskDirectory: string,
	destinationTaskDirectory: string,
	fileName: string,
) => {
	try {
		await fs.mkdir(destinationTaskDirectory, { recursive: true })
		await fs.copyFile(path.join(sourceTaskDirectory, fileName), path.join(destinationTaskDirectory, fileName))
		return true
	} catch (error) {
		if (isSkippableImportError(error)) {
			return false
		}

		throw error
	}
}

const pathExists = async (candidatePath: string) => {
	try {
		await fs.access(candidatePath)
		return true
	} catch {
		return false
	}
}

const getImportableTaskFileNames = async (sourceTaskDirectory: string) => {
	const fileNames: string[] = []

	for (const fileName of IMPORTABLE_TASK_FILE_NAMES) {
		try {
			await fs.access(path.join(sourceTaskDirectory, fileName))
			fileNames.push(fileName)
		} catch (error) {
			if (isSkippableImportError(error)) {
				continue
			}

			throw error
		}
	}

	return fileNames
}

const collectImportableTaskPlans = async (sourceRoots: string[]) => {
	const taskPlans: ImportableTaskPlan[] = []
	const taskIds = new Set<string>()

	for (const sourceRoot of sourceRoots) {
		const sourceTasksRoot = path.join(sourceRoot, "tasks")
		let entries: Dirent[]

		try {
			entries = await fs.readdir(sourceTasksRoot, { withFileTypes: true })
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException
			if (nodeError.code === "ENOENT") {
				continue
			}
			throw error
		}

		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) {
				continue
			}

			// Preserve source-root priority: the first importable occurrence of a task ID wins.
			if (taskIds.has(entry.name)) {
				continue
			}

			const sourceTaskDirectory = path.join(sourceTasksRoot, entry.name)
			const fileNames = await getImportableTaskFileNames(sourceTaskDirectory)

			if (!fileNames.includes(GlobalFileNames.historyItem)) {
				continue
			}

			taskPlans.push({
				taskId: entry.name,
				sourceTaskDirectory,
				fileNames,
			})
			taskIds.add(entry.name)
		}
	}

	return {
		taskPlans,
		totalTaskCount: taskPlans.length,
	}
}

export const resolveRooHistoryImportPaths = async (globalStoragePath: string): Promise<RooHistoryImportPaths> => {
	const zooExtensionDomain = `${Package.publisher}.${Package.name}`
	const zooStorageRoot = await getStorageBasePath(globalStoragePath)
	const rooDefaultStorageRoot = path.join(path.dirname(globalStoragePath), ROO_STORAGE_DIRECTORY)
	const rooCustomStorageRoot = getConfiguredCustomStoragePath(ROO_CONFIGURATION_SECTION)

	return {
		rooExtensionDomain: ROO_EXTENSION_DOMAIN,
		zooExtensionDomain,
		rooStorageRoots: dedupePaths([rooDefaultStorageRoot, ...(rooCustomStorageRoot ? [rooCustomStorageRoot] : [])]),
		zooStorageRoot,
	}
}

export const importRooTaskHistory = async (
	globalStoragePath: string,
	onProgress?: (progress: RooHistoryImportProgress) => Promise<void> | void,
): Promise<RooHistoryImportResult> => {
	const paths = await resolveRooHistoryImportPaths(globalStoragePath)
	const destinationComparablePath = toComparablePath(paths.zooStorageRoot)
	const sourceRoots = paths.rooStorageRoots.filter(
		(sourceRoot) => toComparablePath(sourceRoot) !== destinationComparablePath,
	)
	const destinationTasksRoot = path.join(paths.zooStorageRoot, "tasks")
	const { taskPlans, totalTaskCount: foundTaskCount } = await collectImportableTaskPlans(sourceRoots)
	const importedTaskIds = new Set<string>()
	let importedFileCount = 0
	let copiedFileCount = 0
	const importableTaskPlans: ImportableTaskPlan[] = []

	await fs.mkdir(destinationTasksRoot, { recursive: true })

	for (const taskPlan of taskPlans) {
		const destinationTaskDirectory = path.join(destinationTasksRoot, taskPlan.taskId)
		if (await pathExists(destinationTaskDirectory)) {
			continue
		}

		importableTaskPlans.push(taskPlan)
	}

	const totalTaskCount = importableTaskPlans.length
	let totalFileCount = importableTaskPlans.reduce((count, taskPlan) => count + taskPlan.fileNames.length, 0)

	const reportProgress = async (currentTaskId?: string, currentFileName?: string) => {
		if (!onProgress) {
			return
		}

		await onProgress({
			copiedFileCount,
			totalFileCount,
			importedTaskCount: importedTaskIds.size,
			totalTaskCount,
			currentTaskId,
			currentFileName,
		})
	}

	await reportProgress()

	for (const taskPlan of importableTaskPlans) {
		const destinationTaskDirectory = path.join(destinationTasksRoot, taskPlan.taskId)
		const destinationTaskDirectoryExisted = await pathExists(destinationTaskDirectory)

		if (destinationTaskDirectoryExisted) {
			totalFileCount -= taskPlan.fileNames.length
			continue
		}

		const historyItemCopied = await copyTaskFileIfPresent(
			taskPlan.sourceTaskDirectory,
			destinationTaskDirectory,
			GlobalFileNames.historyItem,
		)

		if (!historyItemCopied) {
			totalFileCount -= taskPlan.fileNames.length
			if (!destinationTaskDirectoryExisted) {
				await fs.rm(destinationTaskDirectory, { recursive: true, force: true })
			}
			await reportProgress(taskPlan.taskId, GlobalFileNames.historyItem)
			continue
		}

		importedTaskIds.add(taskPlan.taskId)
		importedFileCount += 1
		copiedFileCount += 1
		await reportProgress(taskPlan.taskId, GlobalFileNames.historyItem)

		for (const fileName of taskPlan.fileNames) {
			if (fileName === GlobalFileNames.historyItem) {
				continue
			}

			if (await copyTaskFileIfPresent(taskPlan.sourceTaskDirectory, destinationTaskDirectory, fileName)) {
				importedFileCount += 1
				copiedFileCount += 1
			} else {
				totalFileCount -= 1
			}

			await reportProgress(taskPlan.taskId, fileName)
		}
	}

	return {
		...paths,
		rooStorageRoots: sourceRoots,
		foundTaskCount,
		importedTaskCount: importedTaskIds.size,
		importedFileCount,
	}
}
