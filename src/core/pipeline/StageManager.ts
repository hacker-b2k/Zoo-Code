/**
 * StageManager — per-stage lifecycle (creation, prompt, run, validate, destroy).
 *
 * Phase 2: real LLM execution via injected executor, with automatic
 * retry on Zod validation failure (up to 3 attempts).
 */

import type { ZodSchema } from "zod"

import { EventBus, type PipelineEvent } from "./EventBus.js"
import { CheckpointManager } from "./CheckpointManager.js"
import { StagePromptBuilder } from "./StagePromptBuilder.js"
import type { PipelineContext } from "./types.js"

export interface StageManagerConfig {
	stageId: string
	stageName: string
	/** Optional Zod schema applied to the stage's output. */
	outputSchema?: ZodSchema
	/** Optional executor. Phase 2 injects the real LLM call here. */
	executor?: (systemPrompt: string, userMessage: string) => Promise<unknown>
}

export interface StageRunResult {
	stageId: string
	ok: boolean
	output?: unknown
	error?: string
	durationMs: number
	retries: number
}

/** Maximum number of retries when Zod validation fails. */
const MAX_VALIDATION_RETRIES = 3

export class StageManager {
	private readonly eventBus: EventBus
	private readonly checkpointManager: CheckpointManager
	private readonly promptBuilder: StagePromptBuilder

	constructor(
		private readonly config: StageManagerConfig,
		deps: {
			eventBus: EventBus
			checkpointManager: CheckpointManager
			promptBuilder: StagePromptBuilder
		},
	) {
		this.eventBus = deps.eventBus
		this.checkpointManager = deps.checkpointManager
		this.promptBuilder = deps.promptBuilder
	}

	async run(ctx: PipelineContext): Promise<StageRunResult> {
		const start = Date.now()
		let retries = 0
		this.emitLifecycle(ctx, "StageStarted")

		const systemPrompt = this.promptBuilder.buildSystemPrompt(this.config.stageId)
		const userMessage = this.promptBuilder.buildUserMessage(this.config.stageId, ctx)

		for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
			try {
				const raw = this.config.executor
					? await this.config.executor(systemPrompt, userMessage)
					: this.skeletonOutput(ctx)

				const validated = this.config.outputSchema ? this.config.outputSchema.parse(raw) : raw

				this.checkpointManager.save({
					pipelineId: ctx.pipelineId,
					taskId: ctx.taskId,
					completedStages: [...ctx.completedStages, this.config.stageId],
					snapshots: [
						{
							stageId: this.config.stageId,
							timestamp: Date.now(),
							output: validated,
						},
					],
				})

				this.emitLifecycle(ctx, "StageFinished", { output: validated })
				return {
					stageId: this.config.stageId,
					ok: true,
					output: validated,
					durationMs: Date.now() - start,
					retries,
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				const isZodError = error instanceof Error && error.name === "ZodError"

				// Retry on validation errors (ZodError)
				if (isZodError && attempt < MAX_VALIDATION_RETRIES) {
					retries++
					this.emitLifecycle(ctx, "StageRetry", {
						attempt: attempt + 1,
						maxAttempts: MAX_VALIDATION_RETRIES + 1,
						error: message,
					})
					continue
				}

				// Terminal failure — no more retries
				this.emitLifecycle(ctx, "StageFailed", { error: message, retries })
				return {
					stageId: this.config.stageId,
					ok: false,
					error: message,
					durationMs: Date.now() - start,
					retries,
				}
			}
		}

		// Unreachable, but TypeScript needs a return path
		return {
			stageId: this.config.stageId,
			ok: false,
			error: "Max retries exceeded",
			durationMs: Date.now() - start,
			retries,
		}
	}

	/** Phase 1 placeholder: deterministic, schema-friendly output. */
	private skeletonOutput(ctx: PipelineContext): unknown {
		return {
			summary: `Phase 1 skeleton output for ${this.config.stageId}`,
			primaryGoal: "n/a",
			constraints: [],
			hiddenRequirements: [],
			risks: [],
			missingInfo: [],
			successCriteria: [],
			confidence: 50,
			confidenceRationale: "Phase 1 skeleton: no real LLM call yet",
			_pipelineContextMarker: ctx.pipelineId,
		}
	}

	private emitLifecycle(
		ctx: PipelineContext,
		type: PipelineEvent["type"],
		extra: Record<string, unknown> = {},
	): void {
		this.eventBus.emit({
			type,
			pipelineId: ctx.pipelineId,
			stageId: this.config.stageId,
			timestamp: Date.now(),
			payload: extra,
		})
	}
}
