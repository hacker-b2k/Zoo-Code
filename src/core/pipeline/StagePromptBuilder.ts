/**
 * StagePromptBuilder — constructs the system prompt and user message for each stage.
 *
 * Phase 4: real prompts for all 7 stages.
 */

import type { PipelineContext } from "./types.js"
import {
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

export class StagePromptBuilder {
	buildSystemPrompt(stageId: string): string {
		switch (stageId) {
			case "intent":
				return buildIntentSystemPrompt()
			case "planner":
				return buildPlannerSystemPrompt()
			case "architect":
				return buildArchitectSystemPrompt()
			case "coder":
				return buildCoderSystemPrompt()
			case "reviewer":
				return buildReviewerSystemPrompt()
			case "final-review":
				return buildFinalReviewSystemPrompt()
			case "response":
				return buildResponseSimplifierSystemPrompt()
			default:
				return [
					`[Deep Sequential Agentic Pipeline]`,
					``,
					`Stage: ${stageId}`,
					`This stage's prompt is not yet implemented.`,
				].join("\n")
		}
	}

	buildUserMessage(stageId: string, ctx: PipelineContext): string {
		switch (stageId) {
			case "intent":
				return buildIntentUserMessage(ctx.userMessage, ctx.userImages)
			case "planner":
				return buildPlannerUserMessage(ctx.intentArtifact)
			case "architect":
				return buildArchitectUserMessage(ctx.intentArtifact, ctx.requirementsArtifact, ctx.taskListArtifact)
			case "coder":
				return buildCoderUserMessage(
					ctx.intentArtifact,
					ctx.requirementsArtifact,
					ctx.taskListArtifact,
					ctx.blueprintArtifact,
				)
			case "reviewer":
				return buildReviewerUserMessage(ctx.intentArtifact, ctx.requirementsArtifact, ctx.blueprintArtifact, [])
			case "final-review":
				return buildFinalReviewUserMessage(
					ctx.intentArtifact,
					ctx.requirementsArtifact,
					ctx.blueprintArtifact,
					ctx.codeArtifacts,
					ctx.reviewReport,
				)
			case "response":
				return buildResponseSimplifierUserMessage(
					ctx.userMessage,
					ctx.approvalReport,
					ctx.codeArtifacts,
					ctx.reviewReport,
				)
			default:
				return `[Phase placeholder] Pipeline: ${ctx.pipelineId}, Stage: ${stageId}`
		}
	}
}
