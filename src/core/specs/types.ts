/**
 * Virtual Spec Workspace types (F-001).
 * Bodies live on disk under globalStorage; this module holds metadata shapes only.
 */

export const SPEC_SCHEMA_VERSION = 1 as const

/** Supported document kinds for the virtual spec foundation. */
export type SpecDocKind = "requirements" | "design" | "tasks" | "notes" | "custom"

/** Active planning stage for a SpecWorkspace. */
export type SpecStage = "requirements" | "design" | "tasks"

export interface SpecDocument {
	/** Stable id (uuid, or fixed id for starter docs). */
	id: string
	kind: SpecDocKind
	title: string
	/** Basename under docs/, e.g. "requirements.md" */
	fileName: string
	/** Starts at 1; increments on each content write. */
	revision: number
	createdAt: number
	updatedAt: number
}

export interface SpecWorkspace {
	id: string
	title: string
	/** Hash of workspace root used for directory placement. */
	workspaceRootHash: string
	/** Workspace root recorded at creation (display/debug only; never used as write root). */
	workspaceRoot: string
	stage: SpecStage
	/** Document metadata only; bodies are in docs/*.md */
	docs: SpecDocument[]
	/** Reserved for F-012 task linking; empty in F-001. */
	taskIds: string[]
	createdAt: number
	updatedAt: number
	schemaVersion: typeof SPEC_SCHEMA_VERSION
}

export type SpecWorkspaceMeta = SpecWorkspace

export interface SpecWorkspaceIndexEntry {
	id: string
	title: string
	stage: SpecStage
	updatedAt: number
}

export interface SpecWorkspaceIndex {
	version: 1
	workspaceRootHash: string
	updatedAt: number
	entries: SpecWorkspaceIndexEntry[]
}

/** Fixed starter documents created with every new SpecWorkspace. */
export const STARTER_SPEC_DOCS: ReadonlyArray<{
	kind: Extract<SpecDocKind, "requirements" | "design" | "tasks">
	fileName: string
	title: string
}> = [
	{ kind: "requirements", fileName: "requirements.md", title: "Requirements" },
	{ kind: "design", fileName: "design.md", title: "Design" },
	{ kind: "tasks", fileName: "tasks.md", title: "Task list" },
] as const

export interface CreateSpecWorkspaceInput {
	title: string
	workspaceRoot: string
	stage?: SpecStage
}

export interface CreateSpecDocumentInput {
	id: string
	kind: SpecDocKind
	title: string
	fileName: string
	content: string
}

export interface CreateSpecWorkspaceFromDocumentsInput extends CreateSpecWorkspaceInput {
	documents: CreateSpecDocumentInput[]
	reason?: Extract<SpecDocumentChangeReason, "import" | "template">
}

export type SpecDocumentChangeReason = "write" | "restore" | "import" | "template" | "initial"

export interface WriteSpecDocumentInput {
	specId: string
	workspaceRoot: string
	/** Document id or fixed kind (requirements | design | tasks). */
	docIdOrKind: string
	content: string
	title?: string
	/** Optional optimistic concurrency guard. */
	expectedRevision?: number
	/** Durable mutation source recorded in history/events. */
	reason?: Exclude<SpecDocumentChangeReason, "initial">
}

export interface RestoreSpecDocumentRevisionInput {
	specId: string
	workspaceRoot: string
	docIdOrKind: string
	revision: number
	expectedCurrentRevision?: number
}

export interface SpecRevisionEntry {
	revision: number
	createdAt: number
	contentHash: string
	byteLength: number
	reason: SpecDocumentChangeReason
}

export interface SpecDocumentWithContent {
	meta: SpecDocument
	content: string
}
