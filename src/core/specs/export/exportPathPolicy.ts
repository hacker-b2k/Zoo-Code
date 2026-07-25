import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"

import { normalizeFsPath } from "../paths"

export interface ValidatedExportTarget {
	absolutePath: string
	exists: boolean
	contentHash: string
}

/**
 * Normalize and validate a user-picked absolute destination directory.
 * Destinations may be anywhere (project, Desktop, other drives) — not limited
 * to the VS Code workspace root.
 */
export function normalizeExportDestination(destinationDirectory: string): string {
	if (!destinationDirectory || !destinationDirectory.trim()) {
		throw new Error("Export destination directory is required")
	}
	const normalized = normalizeFsPath(destinationDirectory)
	if (normalized.includes("\0")) {
		throw new Error("Invalid export destination directory")
	}
	return normalized
}

/**
 * Join destination directory with a safe markdown basename.
 */
export function joinExportDestinationFile(
	destinationDirectory: string,
	fileName: string,
): {
	absolutePath: string
	displayName: string
} {
	const dest = normalizeExportDestination(destinationDirectory)
	const safeName = path.basename(fileName)
	if (!safeName || safeName !== fileName.replace(/\\/g, "/").split("/").pop()) {
		throw new Error(`Unsafe export file name: ${fileName}`)
	}
	if (safeName.includes("..") || safeName.includes("/") || safeName.includes("\\") || safeName.includes("\0")) {
		throw new Error(`Unsafe export file name: ${fileName}`)
	}
	if (!/\.md$/i.test(safeName)) {
		throw new Error(`Export file must be markdown: ${fileName}`)
	}
	const absolutePath = path.resolve(dest, safeName)
	// Ensure join did not escape dest (defense in depth)
	const destKey = process.platform === "win32" ? dest.toLowerCase() : dest
	const absKey =
		process.platform === "win32" ? normalizeFsPath(absolutePath).toLowerCase() : normalizeFsPath(absolutePath)
	if (absKey !== destKey && !absKey.startsWith(destKey + "/")) {
		throw new Error(`Export target escapes destination: ${fileName}`)
	}
	return { absolutePath, displayName: safeName }
}

/**
 * Validate an absolute export file path under a known destination directory.
 * Checks existence/hash; does not require destination to be inside the workspace.
 */
export async function validateExportAbsoluteTarget(
	destinationDirectory: string,
	fileName: string,
): Promise<ValidatedExportTarget & { displayName: string }> {
	const { absolutePath, displayName } = joinExportDestinationFile(destinationDirectory, fileName)
	const dest = normalizeExportDestination(destinationDirectory)

	// Ensure parent is the destination (or will be created as dest)
	const parentDir = path.dirname(absolutePath)
	const parentNorm = normalizeFsPath(parentDir)
	const destNorm = dest
	const parentKey = process.platform === "win32" ? parentNorm.toLowerCase() : parentNorm
	const destKey = process.platform === "win32" ? destNorm.toLowerCase() : destNorm
	if (parentKey !== destKey) {
		throw new Error(`Export target parent must be the destination folder: ${displayName}`)
	}

	let exists = false
	let contentHash = ""
	try {
		const stat = await fs.stat(absolutePath)
		if (stat.isDirectory()) {
			throw new Error(`Export target is a directory: ${displayName}`)
		}
		exists = true
		const content = await fs.readFile(absolutePath, "utf8")
		contentHash = createHash("sha256").update(content, "utf8").digest("hex")
	} catch (error: unknown) {
		if (error instanceof Error && error.message.startsWith("Export target is a directory")) {
			throw error
		}
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
			throw error
		}
	}

	return { absolutePath, exists, contentHash, displayName }
}

/** @deprecated Use joinExportDestinationFile — kept name for minimal call-site churn during migration. */
export function joinExportRelativePath(targetDirectory: string | undefined, fileName: string): string {
	if (!targetDirectory) {
		const safeName = path.basename(fileName)
		if (!safeName || safeName !== fileName.replace(/\\/g, "/").split("/").pop()) {
			throw new Error(`Unsafe export file name: ${fileName}`)
		}
		return safeName
	}
	// If absolute, treat as destination dir and return basename only for display keys
	const isAbs = path.isAbsolute(targetDirectory) || /^[a-zA-Z]:[\\/]/.test(targetDirectory)
	if (isAbs) {
		return joinExportDestinationFile(targetDirectory, fileName).displayName
	}
	const safeName = path.basename(fileName)
	const dir = targetDirectory.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
	if (dir.includes("..") || path.isAbsolute(dir) || /^[a-zA-Z]:/.test(dir)) {
		throw new Error(`Invalid export target directory: ${targetDirectory}`)
	}
	return dir ? `${dir}/${safeName}` : safeName
}
