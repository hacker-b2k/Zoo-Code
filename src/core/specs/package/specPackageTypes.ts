/**
 * F-023: Combined Spec Package format (v1).
 * Single-file JSON bundle (`.zspec`) for exporting/importing one virtual Spec pack.
 * Fully backward compatible with individual .md import/export (F-010/F-011).
 */

import type { SpecDocKind, SpecStage } from "../types"

export const SPEC_PACKAGE_FORMAT = "zoo-spec-package" as const
export const SPEC_PACKAGE_VERSION = 1 as const

export interface SpecPackageSourceMeta {
	/** Trace-only original pack id (never reused as storage key on import). */
	specId?: string
	title: string
	stage: SpecStage
	createdAt: number
	updatedAt: number
	schemaVersion: number
}

export interface SpecPackageDocument {
	id: string
	kind: SpecDocKind | string
	title: string
	fileName: string
	revision: number
	createdAt: number
	updatedAt: number
	content: string
	contentHash: string
}

export interface SpecPackage {
	format: typeof SPEC_PACKAGE_FORMAT
	formatVersion: typeof SPEC_PACKAGE_VERSION
	exportedAt: number
	exporter: string
	source: SpecPackageSourceMeta
	documents: SpecPackageDocument[]
	/** SHA-256 over canonical payload (excluding this field) */
	packageHash?: string
}

export interface SpecPackageExportOptions {
	workspaceRoot: string
	specId: string
	docIds: string[]
}

export interface SpecPackageImportPlan {
	workspaceRoot: string
	packagePath: string
	proposedTitle: string
	proposedStage: SpecStage
	documents: Array<{
		id: string
		kind: SpecDocKind | string
		title: string
		fileName: string
		revision: number
		byteLength: number
		contentHash: string
	}>
	skipped: Array<{ reason: string }>
}

export interface CommitSpecPackageImportInput {
	workspaceRoot: string
	packagePath: string
	proposedTitle?: string
	/**
	 * Document ids (from {@link SpecPackageImportPlan}) to include.
	 * Omit / empty to import all planned documents. Content is re-read
	 * from the package file inside commit (plan never exposes bodies).
	 */
	documentIds?: string[]
}
