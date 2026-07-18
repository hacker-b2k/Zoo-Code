/**
 * Pipeline module — public surface.
 *
 * Phase 3: Stages 1-5 fully wired. Coder and Reviewer run in parallel.
 * ReviewBuffer provides event-driven communication between them.
 */

export { AGENTIC_MODES, DEFAULT_PIPELINE_SETTINGS, type AgenticMode, type PipelineSettings } from "./types.js"

export { PipelineController } from "./PipelineController.js"
export type { PipelineControllerConfig, PipelineResult } from "./PipelineController.js"

export { PipelineScheduler } from "./PipelineScheduler.js"
export type { StageDefinition, StageExecutionOutcome } from "./PipelineScheduler.js"

export { StageManager } from "./StageManager.js"
export type { StageManagerConfig, StageRunResult } from "./StageManager.js"

export { CheckpointManager } from "./CheckpointManager.js"
export type { PipelineCheckpoint, CheckpointSnapshot } from "./CheckpointManager.js"

export { MemoryStore } from "./MemoryStore.js"
export type { MemoryPartition, MemoryAccessPolicy } from "./MemoryStore.js"

export { EventBus } from "./EventBus.js"
export type { PipelineEvent, PipelineEventListener } from "./EventBus.js"

export { ReviewBuffer } from "./ReviewBuffer.js"
export type { CoderEvent, CoderEventType, ReviewFinding, ReviewSeverity } from "./ReviewBuffer.js"

export { CoderEventStream } from "./CoderEventStream.js"

export { StagePromptBuilder } from "./StagePromptBuilder.js"

export {
	IntentArtifactSchema,
	RequirementsArtifactSchema,
	TaskListArtifactSchema,
	BlueprintArtifactSchema,
	CodeArtifactsSchema,
	ReviewReportSchema,
	ApprovalReportSchema,
	FinalResponseSchema,
	type IntentArtifact,
	type RequirementsArtifact,
	type TaskListArtifact,
	type BlueprintArtifact,
	type CodeArtifacts,
	type ReviewReport,
	type ApprovalReport,
	type FinalResponse,
} from "./artifacts.js"

export { callLlmForText, collectStreamText, extractJsonFromText } from "./streamToText.js"

export {
	buildIntentSystemPrompt,
	buildPlannerSystemPrompt,
	buildArchitectSystemPrompt,
	buildCoderSystemPrompt,
	buildReviewerSystemPrompt,
	buildFinalReviewSystemPrompt,
	buildResponseSimplifierSystemPrompt,
	buildIntentUserMessage,
	buildPlannerUserMessage,
	buildArchitectUserMessage,
	buildCoderUserMessage,
	buildReviewerUserMessage,
	buildFinalReviewUserMessage,
	buildResponseSimplifierUserMessage,
} from "./prompts.js"

// Stage entrypoints
export { StageIntent } from "./stages/StageIntent.js"
export { StagePlanner } from "./stages/StagePlanner.js"
export { StageArchitect } from "./stages/StageArchitect.js"
export { StageCoder } from "./stages/StageCoder.js"
export { StageReviewer } from "./stages/StageReviewer.js"
export { StageFinalReview } from "./stages/StageFinalReview.js"
export { StageResponse } from "./stages/StageResponse.js"

// Agentic mode helper
export { getAgenticMode } from "./getAgenticMode.js"
export type { AgenticMode as AgenticModeResolved } from "./getAgenticMode.js"
