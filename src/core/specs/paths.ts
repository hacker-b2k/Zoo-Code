import { createHash } from "crypto"
import * as path from "path"

import { getSpecsDirectoryPath } from "../../utils/storage"

/** Allowlist for markdown basenames under docs/. */
const SAFE_DOC_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/

/** Safe ids: no path separators, no ".." segments. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Normalize a workspace root for stable hashing across OS path styles.
 * Uses path.resolve then lowercases drive letters on Windows-style roots.
 */
export function normalizeWorkspaceRoot(workspaceRoot: string): string {
	if (!workspaceRoot || !workspaceRoot.trim()) {
		throw new Error("workspaceRoot is required")
	}

	let normalized = path.resolve(workspaceRoot.trim())

	// Unify separators for hash stability
	normalized = normalized.replace(/\\/g, "/")

	// Lowercase Windows drive letter (e.g. C:/ → c:/)
	if (/^[A-Za-z]:\//.test(normalized)) {
		normalized = normalized[0].toLowerCase() + normalized.slice(1)
	}

	// Strip trailing slash (except root-like paths)
	if (normalized.length > 1 && normalized.endsWith("/")) {
		normalized = normalized.slice(0, -1)
	}

	return normalized
}

/**
 * Normalize an arbitrary filesystem path the same way as workspace roots
 * (resolve, `/` separators, lowercase Windows drive, strip trailing slash).
 */
export function normalizeFsPath(fsPath: string): string {
	if (!fsPath || !fsPath.trim()) {
		throw new Error("path is required")
	}
	return normalizeWorkspaceRoot(fsPath)
}

/**
 * Return the relative path of `absolutePath` inside `workspaceRoot`, using `/`
 * separators, or `null` if the path is outside the workspace.
 *
 * Handles Windows drive-letter case, separator mismatches, and trailing
 * slashes that make raw `path.relative` falsely report escapes.
 */
export function relativePathInsideWorkspace(workspaceRoot: string, absolutePath: string): string | null {
	const rootNorm = normalizeWorkspaceRoot(workspaceRoot)
	const targetNorm = normalizeFsPath(absolutePath)

	// Case-insensitive containment on Windows (full path, not just drive letter)
	const rootKey = process.platform === "win32" ? rootNorm.toLowerCase() : rootNorm
	const targetKey = process.platform === "win32" ? targetNorm.toLowerCase() : targetNorm

	if (targetKey === rootKey) {
		return ""
	}
	if (!targetKey.startsWith(rootKey + "/")) {
		return null
	}

	// Prefer Node relative for correct `..` collapse, then re-check containment
	const platformRoot = path.resolve(workspaceRoot.trim())
	const platformTarget = path.resolve(absolutePath.trim())
	let relative = path.relative(platformRoot, platformTarget).replace(/\\/g, "/")

	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		// Fallback: slice from normalized forms (handles drive-case mismatches)
		relative = targetNorm.slice(rootNorm.length).replace(/^\/+/, "")
		if (process.platform === "win32") {
			relative = targetKey.slice(rootKey.length).replace(/^\/+/, "")
		}
	}

	if (relative.startsWith("..") || path.isAbsolute(relative) || relative.includes("\0")) {
		return null
	}
	return relative
}

/** True when `absolutePath` resolves inside `workspaceRoot` (or is the root itself). */
export function isPathInsideWorkspace(workspaceRoot: string, absolutePath: string): boolean {
	return relativePathInsideWorkspace(workspaceRoot, absolutePath) !== null
}

/**
 * Hash of normalized workspace root — first 16 hex chars of SHA-256.
 */
export function hashWorkspaceRoot(workspaceRoot: string): string {
	const normalized = normalizeWorkspaceRoot(workspaceRoot)
	return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16)
}

export function assertSafeId(id: string, label: string): void {
	if (!id || !SAFE_ID.test(id)) {
		throw new Error(`Invalid ${label}: must be a simple alphanumeric id`)
	}
	if (id.includes("..")) {
		throw new Error(`Invalid ${label}: path traversal is not allowed`)
	}
}

/**
 * Normalize optional spec_id from model tool args (F-005e / issues report).
 * Models often emit string sentinels instead of JSON null:
 * "null", "undefined", "None" (Python-style), "nil".
 * Empty / sentinel strings → null (create or resolve-by-fallback).
 * Real ids are returned trimmed.
 *
 * F-006b: does NOT accept truncated display ids (containing … or ...); callers
 * should reject those with a recoverable error via isTruncatedDisplaySpecId.
 */
export function coerceOptionalSpecId(value: unknown): string | null {
	if (value === undefined || value === null) {
		return null
	}
	if (typeof value !== "string") {
		return null
	}
	const trimmed = value.trim()
	if (!trimmed) {
		return null
	}
	const lower = trimmed.toLowerCase()
	if (lower === "null" || lower === "undefined" || lower === "none" || lower === "nil") {
		return null
	}
	return trimmed
}

/**
 * True if value looks like a F-006 display-only abbreviated id (e.g. "9b09f722…").
 * These must never be accepted as tool spec_id parameters.
 */
export function isTruncatedDisplaySpecId(value: unknown): boolean {
	if (typeof value !== "string") {
		return false
	}
	const t = value.trim()
	if (!t) {
		return false
	}
	// Unicode ellipsis or ASCII triple-dot used in shortId() / model copies
	if (t.includes("…") || t.includes("...")) {
		return true
	}
	return false
}

/** Clear recovery message when agents paste display-only ids from environment_details. */
export function truncatedSpecIdErrorMessage(raw: string): string {
	return (
		`Rejected display-only/truncated spec_id "${raw.trim()}". ` +
		`Abbreviated ids in environment_details (e.g. 8-char prefix + …) are NOT tool parameters. ` +
		`For the Active pack: pass spec_id: null (read_spec resolves last-opened; write_spec create needs title + null). ` +
		`For a specific pack: call list_specs and use the full id from the tool result only.`
	)
}

export function assertSafeDocFileName(fileName: string): void {
	if (!fileName || !SAFE_DOC_FILE_NAME.test(fileName)) {
		throw new Error(`Invalid document fileName: ${fileName}`)
	}
	if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
		throw new Error(`Invalid document fileName: path segments are not allowed`)
	}
}

/**
 * Ensure targetPath resolves under baseDir (prevents path traversal writes).
 */
export function assertPathInsideBase(baseDir: string, targetPath: string): void {
	const resolvedBase = path.resolve(baseDir)
	const resolvedTarget = path.resolve(targetPath)
	const relative = path.relative(resolvedBase, resolvedTarget)
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`Refusing to access path outside specs storage: ${targetPath}`)
	}
}

export async function getWorkspaceSpecsRoot(globalStoragePath: string, workspaceRootHash: string): Promise<string> {
	assertSafeId(workspaceRootHash, "workspaceRootHash")
	const specsRoot = await getSpecsDirectoryPath(globalStoragePath)
	return path.join(specsRoot, workspaceRootHash)
}

export async function getSpecDirectory(
	globalStoragePath: string,
	workspaceRootHash: string,
	specId: string,
): Promise<string> {
	assertSafeId(workspaceRootHash, "workspaceRootHash")
	assertSafeId(specId, "specId")
	const workspaceRoot = await getWorkspaceSpecsRoot(globalStoragePath, workspaceRootHash)
	return path.join(workspaceRoot, specId)
}

export function getDocsDirectory(specDir: string): string {
	return path.join(specDir, "docs")
}

export function getDocFilePath(specDir: string, fileName: string): string {
	assertSafeDocFileName(fileName)
	const docsDir = getDocsDirectory(specDir)
	const target = path.join(docsDir, fileName)
	assertPathInsideBase(docsDir, target)
	return target
}
