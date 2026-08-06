import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"

import { normalizeWorkspaceRoot } from "../paths"
import { SpecService } from "../SpecService"
import { normalizeExportDestination, validateExportAbsoluteTarget } from "./exportPathPolicy"
import type {
	SpecExportCommitInput,
	SpecExportFileResult,
	SpecExportPlan,
	SpecExportPlanItem,
	SpecExportRequest,
	SpecExportResult,
} from "./exportTypes"

function hashContent(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex")
}

function transactionId(): string {
	return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * F-010: explicit UI export planner/committer.
 * Destination may be any user-picked absolute directory (project, Desktop, other repo).
 * Never writes unless commit() is called after plan + confirmation.
 * Default conflict action is skip; staged writes + backup/rollback on failure.
 * Virtual storage is never modified by export.
 */
export class SpecExportCoordinator {
	constructor(private readonly service: SpecService) {}

	async plan(request: SpecExportRequest): Promise<SpecExportPlan> {
		const workspaceRoot = normalizeWorkspaceRoot(request.workspaceRoot)
		let destinationDirectory: string
		try {
			destinationDirectory = normalizeExportDestination(request.destinationDirectory)
		} catch (error) {
			return {
				workspaceRoot,
				destinationDirectory: request.destinationDirectory ?? "",
				items: [],
				skipped: [
					{
						relativePath: "*",
						reason: error instanceof Error ? error.message : String(error),
					},
				],
			}
		}

		const items: SpecExportPlanItem[] = []
		const skipped: SpecExportPlan["skipped"] = []
		const seenTargets = new Set<string>()

		for (const selection of request.selections) {
			const doc = await this.service.getDocument(workspaceRoot, selection.specId, selection.docId)
			if (!doc) {
				skipped.push({ relativePath: `${selection.docId}.md`, reason: "document not found" })
				continue
			}

			try {
				const target = await validateExportAbsoluteTarget(destinationDirectory, doc.meta.fileName)
				const relativePath = target.displayName
				const folded = relativePath.toLowerCase()
				if (seenTargets.has(folded)) {
					skipped.push({ relativePath, reason: "duplicate target path" })
					continue
				}
				seenTargets.add(folded)

				items.push({
					specId: selection.specId,
					docId: selection.docId,
					relativePath,
					absoluteTargetPath: target.absolutePath,
					sourceRevision: doc.meta.revision,
					sourceContentHash: hashContent(doc.content),
					sourceByteLength: Buffer.byteLength(doc.content, "utf8"),
					targetExists: target.exists,
					targetContentHash: target.contentHash,
					proposedAction: target.exists ? "skip" : "overwrite",
					warning: target.exists ? "Target file already exists; default action is skip" : undefined,
				})
			} catch (error) {
				skipped.push({
					relativePath: doc.meta.fileName,
					reason: error instanceof Error ? error.message : String(error),
				})
			}
		}

		return { workspaceRoot, destinationDirectory, items, skipped }
	}

	async commit(input: SpecExportCommitInput): Promise<SpecExportResult> {
		const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot)
		const txId = transactionId()
		const results: SpecExportFileResult[] = []
		const backups: Array<{ target: string; backup: string }> = []
		const created: string[] = []
		const tmpFiles: string[] = []

		try {
			const prepared: Array<{
				item: SpecExportPlanItem
				content: string
				action: "skip" | "overwrite" | "create"
			}> = []

			for (const item of input.items) {
				const resolution = input.conflictResolutions?.[item.relativePath] ?? item.proposedAction
				if (item.targetExists && resolution === "skip") {
					prepared.push({ item, content: "", action: "skip" })
					continue
				}

				const doc = await this.service.getDocument(workspaceRoot, item.specId, item.docId)
				if (!doc) {
					throw new Error(`Source document disappeared: ${item.docId}`)
				}
				const currentHash = hashContent(doc.content)
				if (currentHash !== item.sourceContentHash) {
					throw new Error(`Source revision changed after planning: ${item.docId}`)
				}

				// Revalidate absolute target by its parent destination + basename
				const destDir = path.dirname(item.absoluteTargetPath)
				const target = await validateExportAbsoluteTarget(destDir, path.basename(item.absoluteTargetPath))
				if (normalizeFsLoose(target.absolutePath) !== normalizeFsLoose(item.absoluteTargetPath)) {
					throw new Error(`Export target path mismatch: ${item.relativePath}`)
				}
				if (target.exists && target.contentHash !== item.targetContentHash) {
					throw new Error(`Target file changed after planning: ${item.relativePath}`)
				}
				if (!item.targetExists && target.exists) {
					throw new Error(`Target file appeared after planning: ${item.relativePath}`)
				}

				prepared.push({
					item,
					content: doc.content,
					action: item.targetExists ? "overwrite" : "create",
				})
			}

			for (const entry of prepared) {
				if (entry.action === "skip") {
					results.push({ relativePath: entry.item.relativePath, status: "skipped" })
					continue
				}

				const { item, content } = entry
				await fs.mkdir(path.dirname(item.absoluteTargetPath), { recursive: true })

				if (entry.action === "overwrite") {
					const backupPath = `${item.absoluteTargetPath}.${txId}.bak`
					await fs.copyFile(item.absoluteTargetPath, backupPath)
					backups.push({ target: item.absoluteTargetPath, backup: backupPath })
				}

				const tmpPath = `${item.absoluteTargetPath}.${txId}.tmp`
				tmpFiles.push(tmpPath)
				await fs.writeFile(tmpPath, content, "utf8")
				await fs.rename(tmpPath, item.absoluteTargetPath)
				const idx = tmpFiles.indexOf(tmpPath)
				if (idx >= 0) tmpFiles.splice(idx, 1)

				if (entry.action === "create") {
					created.push(item.absoluteTargetPath)
					results.push({ relativePath: item.relativePath, status: "created" })
				} else {
					results.push({ relativePath: item.relativePath, status: "overwritten" })
				}
			}

			for (const backup of backups) {
				await fs.rm(backup.backup, { force: true }).catch(() => undefined)
			}

			return { results, rollbackAttempted: false, rollbackComplete: true }
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)

			for (const tmp of tmpFiles) {
				await fs.rm(tmp, { force: true }).catch(() => undefined)
			}
			for (const filePath of created) {
				await fs.rm(filePath, { force: true }).catch(() => undefined)
			}
			for (const backup of backups) {
				await fs.rename(backup.backup, backup.target).catch(() => undefined)
			}

			results.push({ relativePath: "*", status: "failed", error: errorMsg })
			return {
				results,
				rollbackAttempted: true,
				rollbackComplete: true,
			}
		}
	}
}

function normalizeFsLoose(p: string): string {
	return path.resolve(p).replace(/\\/g, "/").toLowerCase()
}
