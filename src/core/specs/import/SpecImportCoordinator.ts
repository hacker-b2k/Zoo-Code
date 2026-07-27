import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"

import { normalizeWorkspaceRoot, relativePathInsideWorkspace } from "../paths"
import { SpecService } from "../SpecService"
import type { SpecDocKind } from "../types"
import type { CommitSpecImportInput, SpecImportCandidate, SpecImportPlan } from "./importTypes"

const MAX_FILES = 200
const MAX_FILE_BYTES = 1024 * 1024
const MAX_TOTAL_BYTES = 10 * 1024 * 1024

/**
 * F-011: explicit import planner/committer.
 * Sources may be anywhere the user picks (Desktop, Downloads, other repos).
 * Import is a copy into virtual storage for the *current* VS Code workspace.
 * Original files are never modified.
 */
export class SpecImportCoordinator {
	constructor(private readonly service: SpecService) {}

	async planSelectedFiles(workspaceRootInput: string, sourcePaths: string[]): Promise<SpecImportPlan> {
		const workspaceRoot = normalizeWorkspaceRoot(workspaceRootInput)
		const candidates: SpecImportCandidate[] = []
		const skipped: SpecImportPlan["skipped"] = []
		let totalBytes = 0
		for (const sourcePathInput of sourcePaths.slice(0, MAX_FILES)) {
			const sourcePath = path.resolve(sourcePathInput)
			if (path.extname(sourcePath).toLowerCase() !== ".md") {
				skipped.push({ sourcePath, reason: "not markdown" })
				continue
			}
			try {
				const realSource = await fs.realpath(sourcePath)
				const stat = await fs.stat(realSource)
				if (!stat.isFile()) {
					skipped.push({ sourcePath, reason: "not a file" })
					continue
				}
				if (stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES) {
					skipped.push({ sourcePath, reason: "size limit exceeded" })
					continue
				}
				const content = await fs.readFile(realSource, "utf8")
				totalBytes += stat.size
				// Display path: workspace-relative when inside current project; else basename.
				const inside = relativePathInsideWorkspace(workspaceRoot, realSource)
				const displayPath = inside !== null ? inside : path.basename(realSource)
				const mapping = mapImportDocument(displayPath, content)
				candidates.push({
					sourcePath: realSource,
					relativePath: displayPath,
					byteLength: Buffer.byteLength(content, "utf8"),
					contentHash: hashContent(content),
					content,
					...mapping,
				})
			} catch (error) {
				skipped.push({ sourcePath, reason: error instanceof Error ? error.message : String(error) })
			}
		}
		if (sourcePaths.length > MAX_FILES) {
			skipped.push({ sourcePath: "", reason: `file limit exceeded (${MAX_FILES})` })
		}
		return { workspaceRoot, candidates, skipped }
	}

	async commit(input: CommitSpecImportInput) {
		const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot)
		const created = []
		for (const candidate of input.candidates) {
			const currentContent = await fs.readFile(candidate.sourcePath, "utf8")
			if (hashContent(currentContent) !== candidate.contentHash) {
				throw new Error(`Import source changed after preview: ${candidate.relativePath}`)
			}
			created.push(
				await this.service.createWorkspaceFromDocuments({
					workspaceRoot,
					title: candidate.proposedTitle,
					documents: [
						{
							id: candidate.proposedDocId,
							kind: candidate.proposedKind,
							title: candidate.proposedTitle,
							fileName: candidate.proposedFileName,
							content: currentContent,
						},
					],
					reason: "import",
				}),
			)
		}
		return created
	}
}

function hashContent(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex")
}

function mapImportDocument(
	relativePath: string,
	content: string,
): {
	proposedTitle: string
	proposedDocId: string
	proposedKind: SpecDocKind
	proposedFileName: string
} {
	const basename = path.basename(relativePath, path.extname(relativePath))
	const lower = basename.toLowerCase()
	let proposedKind: SpecDocKind = "custom"
	if (/requirements?|reqs?/.test(lower)) proposedKind = "requirements"
	else if (/design|architecture|adr|api/.test(lower)) proposedKind = "design"
	else if (/tasks?|implementation|plan/.test(lower)) proposedKind = "tasks"
	else if (/notes?/.test(lower)) proposedKind = "notes"
	const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
	const proposedTitle = heading || basename.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
	const proposedDocId = proposedKind === "custom" ? "custom" : proposedKind
	return { proposedTitle, proposedDocId, proposedKind, proposedFileName: `${proposedDocId}.md` }
}
