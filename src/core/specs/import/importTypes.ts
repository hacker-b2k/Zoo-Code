import type { SpecDocKind } from "../types"

export interface SpecImportCandidate {
	sourcePath: string
	relativePath: string
	byteLength: number
	contentHash: string
	proposedTitle: string
	proposedDocId: string
	proposedKind: SpecDocKind
	proposedFileName: string
	content: string
}

export interface SpecImportPlan {
	workspaceRoot: string
	candidates: SpecImportCandidate[]
	skipped: Array<{ sourcePath: string; reason: string }>
}

export interface CommitSpecImportInput {
	workspaceRoot: string
	candidates: SpecImportCandidate[]
}
