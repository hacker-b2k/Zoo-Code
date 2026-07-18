/**
 * Deep Sequential Agentic Pipeline — shared type definitions.
 *
 * The new pipeline lives entirely under src/core/pipeline/ and never
 * imports from src/core/orchestration/. All cross-stage contracts
 * are described by typed interfaces here, so that no natural-language
 * ambiguity can leak between stages.
 */

import { z } from "zod"

/**
 * Agentic mode discriminator.
 *
 * - "classic" → the existing Classic Orchestration engine runs unchanged.
 * - "deepSequential" → the Deep Sequential Agentic Pipeline runs the
 *   user request through a fixed sequence of isolated stages.
 */
export const AGENTIC_MODES = ["classic", "deepSequential"] as const

export const agenticModeSchema = z.enum(AGENTIC_MODES)

export type AgenticMode = (typeof AGENTIC_MODES)[number]

/**
 * Settings controlling the pipeline. Default: classic mode.
 *
 * Stored in GlobalSettings (see packages/types/src/global-settings.ts).
 */
export interface PipelineSettings {
	agenticMode: AgenticMode
	/** Optional override for total pipeline cost ceiling, in USD. */
	totalCostLimitUsd?: number
	/** Optional confidence threshold (0-100) above which human approval gates auto-bypass. */
	autoApproveConfidenceThreshold?: number
}

export const DEFAULT_PIPELINE_SETTINGS: PipelineSettings = {
	agenticMode: "classic",
	totalCostLimitUsd: 5,
	autoApproveConfidenceThreshold: 90,
}

/**
 * A read-only reference to the executing provider. The pipeline does
 * NOT own provider lifecycle; it borrows the host's provider via this
 * reference. This mirrors the existing `providerRef` pattern in Task.ts.
 */
export interface PipelineProviderRef {
	getCurrentTaskId(): string | undefined
	postStateToWebview(): Promise<void>
}

/**
 * Mutable context bag passed through the pipeline. Each stage reads
 * its declared inputs and writes its declared outputs.
 */
export interface PipelineContext {
	pipelineId: string
	taskId: string
	userMessage: string
	userImages?: string[]

	/** Populated by stages as they complete. */
	intentArtifact?: unknown
	requirementsArtifact?: unknown
	taskListArtifact?: unknown
	blueprintArtifact?: unknown
	codeArtifacts?: unknown
	reviewReport?: unknown
	approvalReport?: unknown
	finalResponse?: unknown

	abortSignal: AbortSignal
	startTime: number
	completedStages: string[]
	currentStage: string
}
