export interface SpecExportDocumentSelection {
	specId: string
	docId: string
}

export interface SpecExportRequest {
	/** Virtual pack home (current VS Code workspace root). Not the export destination. */
	workspaceRoot: string
	selections: SpecExportDocumentSelection[]
	/**
	 * Absolute directory chosen by the user (anywhere: project, Desktop, other repo, etc.).
	 * Files are written as destinationDirectory / safeFileName.
	 */
	destinationDirectory: string
}

export type SpecExportConflictAction = "skip" | "overwrite"

export interface SpecExportPlanItem {
	specId: string
	docId: string
	/** Display / conflict key: basename under destination (e.g. requirements.md). */
	relativePath: string
	absoluteTargetPath: string
	sourceRevision: number
	sourceContentHash: string
	sourceByteLength: number
	targetExists: boolean
	targetContentHash: string
	proposedAction: SpecExportConflictAction
	warning?: string
}

export interface SpecExportPlan {
	workspaceRoot: string
	destinationDirectory: string
	items: SpecExportPlanItem[]
	skipped: Array<{ relativePath: string; reason: string }>
}

export interface SpecExportCommitInput {
	workspaceRoot: string
	items: SpecExportPlanItem[]
	conflictResolutions?: Record<string, SpecExportConflictAction>
}

export interface SpecExportFileResult {
	relativePath: string
	status: "created" | "overwritten" | "skipped" | "failed"
	error?: string
}

export interface SpecExportResult {
	results: SpecExportFileResult[]
	rollbackAttempted: boolean
	rollbackComplete: boolean
}
