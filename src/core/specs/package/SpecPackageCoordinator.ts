import * as fs from "fs/promises"
import * as path from "path"

import { normalizeWorkspaceRoot } from "../paths"
import { SpecService } from "../SpecService"
import type { SpecDocKind, SpecWorkspace } from "../types"
import {
	MAX_SPEC_PACKAGE_DOCUMENT_BYTES,
	MAX_SPEC_PACKAGE_BYTES,
	hashSpecPackageContent,
	normalizeImportedDocumentKind,
	parseSpecPackage,
	safePackageDocumentFileName,
	serializeSpecPackage,
} from "./specPackageCodec"
import {
	SPEC_PACKAGE_FORMAT,
	SPEC_PACKAGE_VERSION,
	type CommitSpecPackageImportInput,
	type SpecPackage,
	type SpecPackageDocument,
	type SpecPackageExportOptions,
	type SpecPackageImportPlan,
} from "./specPackageTypes"

export interface SpecPackageExportPlan {
	workspaceRoot: string
	specId: string
	destinationDocument: string
	pkg: SpecPackage
	byteLength: number
	targetExists: boolean
	targetContentHash: string
}

export interface SpecPackageExportCommitInput {
	plan: SpecPackageExportPlan
	conflictAction?: "skip" | "overwrite"
}

export interface SpecPackageExportResult {
	status: "created" | "overwritten" | "skipped" | "failed"
	path: string
	error?: string
}

/** F-023 combined JSON .zspec package coordinator. */
export class SpecPackageCoordinator {
	constructor(private readonly service: SpecService) {}

	async planExport(options: SpecPackageExportOptions, destinationDocument: string): Promise<SpecPackageExportPlan> {
		const workspaceRoot = normalizeWorkspaceRoot(options.workspaceRoot)
		const workspace = await this.service.getWorkspace(workspaceRoot, options.specId)
		if (!workspace) throw new Error(`Spec workspace not found: ${options.specId}`)
		const selectedIds = options.docIds.length ? new Set(options.docIds) : new Set(workspace.docs.map((d) => d.id))
		const documents: SpecPackageDocument[] = []
		for (const meta of workspace.docs) {
			if (!selectedIds.has(meta.id)) continue
			const document = await this.service.getDocument(workspaceRoot, workspace.id, meta.id)
			if (!document) throw new Error(`Document not found: ${meta.id}`)
			const contentHash = hashSpecPackageContent(document.content)
			documents.push({
				id: meta.id,
				kind: meta.kind,
				title: meta.title,
				fileName: meta.fileName,
				revision: meta.revision,
				createdAt: meta.createdAt,
				updatedAt: meta.updatedAt,
				content: document.content,
				contentHash,
			})
		}
		if (!documents.length) throw new Error("Select at least one document for the combined package")
		const pkgWithoutHash: Omit<SpecPackage, "packageHash"> = {
			format: SPEC_PACKAGE_FORMAT,
			formatVersion: SPEC_PACKAGE_VERSION,
			exportedAt: Date.now(),
			exporter: "zoo-code",
			source: {
				specId: workspace.id,
				title: workspace.title,
				stage: workspace.stage,
				createdAt: workspace.createdAt,
				updatedAt: workspace.updatedAt,
				schemaVersion: workspace.schemaVersion,
			},
			documents,
		}
		const serialized = serializeSpecPackage(pkgWithoutHash)
		const target = await inspectTarget(destinationDocument)
		return {
			workspaceRoot,
			specId: workspace.id,
			destinationDocument: path.resolve(destinationDocument),
			pkg: parseSpecPackage(serialized),
			byteLength: Buffer.byteLength(serialized, "utf8"),
			targetExists: target.exists,
			targetContentHash: target.contentHash,
		}
	}

	async commitExport(input: SpecPackageExportCommitInput): Promise<SpecPackageExportResult> {
		const targetPath = path.resolve(input.plan.destinationDocument)
		try {
			const current = await inspectTarget(targetPath)
			if (input.plan.targetExists && (input.conflictAction ?? "skip") === "skip") {
				return { status: "skipped", path: targetPath }
			}
			if (current.exists && current.contentHash !== input.plan.targetContentHash) {
				return { status: "failed", path: targetPath, error: "Target package changed after planning" }
			}
			if (!input.plan.targetExists && current.exists) {
				return { status: "failed", path: targetPath, error: "Target package appeared after planning" }
			}
			const content = serializeSpecPackage(input.plan.pkg)
			if (Buffer.byteLength(content, "utf8") > MAX_SPEC_PACKAGE_BYTES) {
				return { status: "failed", path: targetPath, error: "Spec package exceeds size limit" }
			}
			await fs.mkdir(path.dirname(targetPath), { recursive: true })
			const temp = `${targetPath}.${process.pid}-${Date.now()}.tmp`
			await fs.writeFile(temp, content, "utf8")
			await fs.rename(temp, targetPath)
			return { status: input.plan.targetExists ? "overwritten" : "created", path: targetPath }
		} catch (error) {
			return { status: "failed", path: targetPath, error: error instanceof Error ? error.message : String(error) }
		}
	}

	async planImport(workspaceRootInput: string, packagePathInput: string): Promise<SpecPackageImportPlan> {
		const workspaceRoot = normalizeWorkspaceRoot(workspaceRootInput)
		const packagePath = path.resolve(packagePathInput)
		const raw = await fs.readFile(packagePath, "utf8")
		const pkg = parseSpecPackage(raw)
		const documents = pkg.documents.map((document, index) => {
			const kind = normalizeImportedDocumentKind(document.kind)
			return {
				id: kind === "custom" ? `custom-${index + 1}` : kind,
				kind,
				title: document.title,
				fileName: safePackageDocumentFileName(document.fileName, kind, document.id),
				revision: document.revision,
				byteLength: Buffer.byteLength(document.content, "utf8"),
				contentHash: document.contentHash,
			}
		})
		return {
			workspaceRoot,
			packagePath,
			proposedTitle: pkg.source.title,
			proposedStage: pkg.source.stage,
			documents,
			skipped: [],
		}
	}

	async commitImport(input: CommitSpecPackageImportInput): Promise<SpecWorkspace> {
		const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot)
		const packagePath = path.resolve(input.packagePath)
		const raw = await fs.readFile(packagePath, "utf8")
		const pkg = parseSpecPackage(raw)
		const selectIds = new Set(input.documentIds ?? [])
		const selectAll = selectIds.size === 0
		const documents: Array<{ id: string; kind: SpecDocKind; title: string; fileName: string; content: string }> = []
		pkg.documents.forEach((document, index) => {
			const kind = normalizeImportedDocumentKind(document.kind)
			// Must match planImport's id scheme (position in original package array).
			const plannedId = kind === "custom" ? `custom-${index + 1}` : kind
			if (!selectAll && !selectIds.has(plannedId)) return
			documents.push({
				id: plannedId,
				kind,
				title: document.title,
				fileName: safePackageDocumentFileName(document.fileName, kind, document.id),
				content: document.content,
			})
		})
		if (!documents.length) throw new Error("No documents selected for package import")
		return this.service.createWorkspaceFromDocuments({
			workspaceRoot,
			title: input.proposedTitle || pkg.source.title,
			stage: pkg.source.stage,
			documents,
			reason: "import",
		})
	}
}

async function inspectTarget(targetPath: string): Promise<{ exists: boolean; contentHash: string }> {
	try {
		const stat = await fs.stat(targetPath)
		if (stat.isDirectory()) throw new Error("Spec package target is a directory")
		const content = await fs.readFile(targetPath, "utf8")
		return { exists: true, contentHash: hashSpecPackageContent(content) }
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { exists: false, contentHash: "" }
		throw error
	}
}
