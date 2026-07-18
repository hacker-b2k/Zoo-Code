/**
 * PipelineScheduler — orders stages, supports parallel execution.
 *
 * Phase 3: runs the Coder (Stage 4) and Reviewer (Stage 5) in parallel.
 * The scheduler follows a DAG:
 *
 *   Intent → Planner → Architect → [Coder || Reviewer] → WAIT
 *
 * Stages 1-3 run sequentially. Stages 4-5 run concurrently.
 * Pipeline waits for both to finish before proceeding.
 */

import { StageManager, type StageManagerConfig } from "./StageManager.js"
import { CheckpointManager } from "./CheckpointManager.js"
import { EventBus } from "./EventBus.js"
import { StagePromptBuilder } from "./StagePromptBuilder.js"
import type { PipelineContext } from "./types.js"

export interface StageDefinition extends Omit<StageManagerConfig, "stageId"> {
	id: string
	/** If set, this stage runs in parallel with the other stages in the same group. */
	parallelGroup?: string
}

export interface StageExecutionOutcome {
	stageId: string
	ok: boolean
	output?: unknown
	error?: string
	retries: number
}

export class PipelineScheduler {
	private readonly eventBus: EventBus
	private readonly checkpointManager: CheckpointManager
	private readonly promptBuilder: StagePromptBuilder

	constructor() {
		this.eventBus = new EventBus()
		this.checkpointManager = new CheckpointManager()
		this.promptBuilder = new StagePromptBuilder()
	}

	getEventBus(): EventBus {
		return this.eventBus
	}

	getCheckpointManager(): CheckpointManager {
		return this.checkpointManager
	}

	/**
	 * Execute stages according to their dependency structure.
	 *
	 * Stages without a `parallelGroup` run sequentially.
	 * Stages with the same `parallelGroup` run concurrently.
	 * The scheduler waits for all stages in a group to complete
	 * before moving to the next sequential stage.
	 */
	async run(stages: StageDefinition[], ctx: PipelineContext): Promise<StageExecutionOutcome[]> {
		const outcomes: StageExecutionOutcome[] = []

		// Group stages into sequential batches, where each batch may
		// contain parallel stages.
		const batches = this.buildBatches(stages)

		for (const batch of batches) {
			if (batch.length === 1) {
				// Sequential stage
				const outcome = await this.runStage(batch[0]!, ctx, outcomes)
				outcomes.push(outcome)
				if (!outcome.ok) break
				ctx = this.updateContext(ctx, outcome)
			} else {
				// Parallel stages — run concurrently
				const parallelOutcomes = await Promise.all(batch.map((stage) => this.runStage(stage, ctx, outcomes)))
				outcomes.push(...parallelOutcomes)
				if (parallelOutcomes.some((o) => !o.ok)) break
				// Update context with all parallel outcomes
				for (const outcome of parallelOutcomes) {
					ctx = this.updateContext(ctx, outcome)
				}
			}
		}

		return outcomes
	}

	/**
	 * Build sequential batches of stages. Stages with the same
	 * parallelGroup are grouped into the same batch.
	 */
	private buildBatches(stages: StageDefinition[]): StageDefinition[][] {
		const batches: StageDefinition[][] = []
		let currentParallelGroup: string | undefined = undefined
		let currentBatch: StageDefinition[] = []

		for (const stage of stages) {
			if (stage.parallelGroup) {
				if (currentParallelGroup === stage.parallelGroup) {
					// Same parallel group — add to current batch
					currentBatch.push(stage)
				} else {
					// New parallel group — flush current batch and start new one
					if (currentBatch.length > 0) {
						batches.push(currentBatch)
					}
					currentParallelGroup = stage.parallelGroup
					currentBatch = [stage]
				}
			} else {
				// Sequential stage — flush any pending parallel batch first
				if (currentBatch.length > 0) {
					batches.push(currentBatch)
					currentBatch = []
					currentParallelGroup = undefined
				}
				batches.push([stage])
			}
		}

		if (currentBatch.length > 0) {
			batches.push(currentBatch)
		}

		return batches
	}

	/**
	 * Run a single stage and return the outcome.
	 */
	private async runStage(
		stage: StageDefinition,
		ctx: PipelineContext,
		priorOutcomes: StageExecutionOutcome[],
	): Promise<StageExecutionOutcome> {
		const manager = new StageManager(
			{
				stageId: stage.id,
				stageName: stage.stageName,
				outputSchema: stage.outputSchema,
				executor: stage.executor,
			},
			{
				eventBus: this.eventBus,
				checkpointManager: this.checkpointManager,
				promptBuilder: this.promptBuilder,
			},
		)

		const stageCtx = { ...ctx, currentStage: stage.id }
		const result = await manager.run(stageCtx)

		return {
			stageId: stage.id,
			ok: result.ok,
			output: result.output,
			error: result.error,
			retries: result.retries,
		}
	}

	/**
	 * Update context with a stage's output.
	 */
	private updateContext(ctx: PipelineContext, outcome: StageExecutionOutcome): PipelineContext {
		if (!outcome.ok || !outcome.output) return ctx
		return {
			...ctx,
			completedStages: [...ctx.completedStages, outcome.stageId],
			...this.getContextUpdate(outcome.stageId, outcome.output),
		}
	}

	/**
	 * Map stage output to the correct context field.
	 */
	private getContextUpdate(stageId: string, output: unknown): Partial<PipelineContext> {
		switch (stageId) {
			case "intent":
				return { intentArtifact: output }
			case "planner":
				return { requirementsArtifact: output }
			case "architect":
				return { blueprintArtifact: output }
			case "coder":
				return { codeArtifacts: output }
			case "reviewer":
				return { reviewReport: output }
			default:
				return {}
		}
	}
}
