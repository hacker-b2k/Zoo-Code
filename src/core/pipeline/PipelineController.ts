/**
 * PipelineController — the sole authority for Deep Sequential Mode.
 *
 * Phase 4: Full 7-stage pipeline with Boss rerun loop.
 *
 *   Intent → Planner → Architect → [Coder || Reviewer] → Final Review → Response
 *                                              ↑               |
 *                                              +--- needs_fixes --+
 *
 * If the Boss says "needs_fixes", Coder + Reviewer rerun with the
 * fix requirements injected. Maximum 3 rerun attempts.
 */

import { v7 as uuidv7 } from "uuid"

import type { ApiHandler } from "../../api/index.js"
import { callLlmForText, extractJsonFromText } from "./streamToText.js"
import { PipelineScheduler } from "./PipelineScheduler.js"
import type { StageDefinition } from "./PipelineScheduler.js"
import { ReviewBuffer } from "./ReviewBuffer.js"
import { CoderEventStream } from "./CoderEventStream.js"
import { StageIntent } from "./stages/StageIntent.js"
import { StagePlanner } from "./stages/StagePlanner.js"
import { StageArchitect } from "./stages/StageArchitect.js"
import { StageCoder } from "./stages/StageCoder.js"
import { StageReviewer } from "./stages/StageReviewer.js"
import { StageFinalReview } from "./stages/StageFinalReview.js"
import { StageResponse } from "./stages/StageResponse.js"
import {
	IntentArtifactSchema,
	RequirementsArtifactSchema,
	BlueprintArtifactSchema,
	CodeArtifactsSchema,
	ReviewReportSchema,
	ApprovalReportSchema,
	FinalResponseSchema,
} from "./artifacts.js"
import type { PipelineContext } from "./types.js"
import type { ReviewFinding } from "./ReviewBuffer.js"

/** Maximum number of times the Boss can send Coder+Reviewer back for fixes. */
const MAX_RERUN_ATTEMPTS = 3

export interface PipelineControllerConfig {
	taskId: string
	userMessage: string
	userImages?: string[]
	abortSignal: AbortSignal
	api?: ApiHandler
	onProgress?: (stageId: string, status: "started" | "completed" | "failed") => void
	onStageOutput?: (stageId: string, output: string) => Promise<void>
	onReviewFinding?: (finding: ReviewFinding) => void
}

export interface PipelineResult {
	pipelineId: string
	taskId: string
	ok: boolean
	completedStages: string[]
	failedStage?: string
	error?: string
	finalResponse?: string
	blueprintArtifact?: unknown
	codeArtifacts?: unknown
	reviewReport?: unknown
	approvalReport?: unknown
	finalResponseArtifact?: unknown
	rerunCount?: number
}

export class PipelineController {
	private readonly scheduler: PipelineScheduler

	constructor() {
		this.scheduler = new PipelineScheduler()
	}

	/**
	 * Build the full 7-stage roster with Coder+Reviewer parallel and
	 * Final Review + Response sequential.
	 */
	private buildStages(config: PipelineControllerConfig, reviewBuffer: ReviewBuffer): StageDefinition[] {
		const api = config.api
		const taskId = config.taskId
		const abortSignal = config.abortSignal

		const makeLlmExecutor = (
			schema: typeof IntentArtifactSchema | typeof RequirementsArtifactSchema | typeof BlueprintArtifactSchema,
		) => {
			return async (systemPrompt: string, userMessage: string): Promise<unknown> => {
				if (!api) throw new Error("PipelineController: ApiHandler required")
				const text = await callLlmForText(api, systemPrompt, userMessage, taskId, abortSignal)
				return extractJsonFromText(text)
			}
		}

		const coderExecutor = async (systemPrompt: string, userMessage: string): Promise<unknown> => {
			if (!api) throw new Error("PipelineController: ApiHandler required")
			const eventStream = new CoderEventStream(reviewBuffer)
			eventStream.buildStarted("Coder stage beginning implementation")
			const text = await callLlmForText(api, systemPrompt, userMessage, taskId, abortSignal)
			const parsed = extractJsonFromText(text)
			eventStream.buildFinished("Coder stage completed", JSON.stringify(parsed))
			return parsed
		}

		const reviewerExecutor = async (systemPrompt: string, userMessage: string): Promise<unknown> => {
			if (!api) throw new Error("PipelineController: ApiHandler required")
			await new Promise((resolve) => setTimeout(resolve, 100))
			const recentEvents = reviewBuffer.getEvents().map((e) => ({
				type: e.type,
				description: e.description,
				timestamp: e.timestamp,
			}))
			const { buildReviewerUserMessage } = await import("./prompts.js")
			const reviewerUserMessage = buildReviewerUserMessage({}, {}, {}, recentEvents)
			const text = await callLlmForText(api, systemPrompt, reviewerUserMessage, taskId, abortSignal)
			const parsed = extractJsonFromText(text)
			if (parsed && typeof parsed === "object" && "findings" in parsed) {
				for (const finding of (parsed as any).findings ?? []) {
					reviewBuffer.pushFinding({
						id: uuidv7(),
						severity: finding.severity ?? "suggestion",
						category: finding.category ?? "general",
						filePath: finding.filePath,
						line: finding.line,
						description: finding.description ?? "",
						recommendation: finding.recommendation ?? "",
						confidence: finding.confidence ?? 50,
						timestamp: Date.now(),
					})
				}
			}
			return parsed
		}

		const finalReviewExecutor = async (systemPrompt: string, userMessage: string): Promise<unknown> => {
			if (!api) throw new Error("PipelineController: ApiHandler required")
			const text = await callLlmForText(api, systemPrompt, userMessage, taskId, abortSignal)
			return extractJsonFromText(text)
		}

		const responseExecutor = async (systemPrompt: string, userMessage: string): Promise<unknown> => {
			if (!api) throw new Error("PipelineController: ApiHandler required")
			const text = await callLlmForText(api, systemPrompt, userMessage, taskId, abortSignal)
			return extractJsonFromText(text)
		}

		return [
			{ ...StageIntent.definition(), executor: makeLlmExecutor(IntentArtifactSchema) },
			{ ...StagePlanner.definition(), executor: makeLlmExecutor(RequirementsArtifactSchema) },
			{ ...StageArchitect.definition(), executor: makeLlmExecutor(BlueprintArtifactSchema) },
			{ ...StageCoder.definition(), executor: coderExecutor, parallelGroup: "engineering" },
			{ ...StageReviewer.definition(), executor: reviewerExecutor, parallelGroup: "engineering" },
			{ ...StageFinalReview.definition(), executor: finalReviewExecutor },
			{ ...StageResponse.definition(), executor: responseExecutor },
		]
	}

	/**
	 * Build only the engineering stages (Coder + Reviewer) for rerun loops.
	 * Stages 1-3 are skipped because their artifacts are already in context.
	 */
	private buildEngineeringStages(config: PipelineControllerConfig, reviewBuffer: ReviewBuffer): StageDefinition[] {
		const api = config.api
		const taskId = config.taskId
		const abortSignal = config.abortSignal

		const coderExecutor = async (systemPrompt: string, userMessage: string): Promise<unknown> => {
			if (!api) throw new Error("PipelineController: ApiHandler required")
			const eventStream = new CoderEventStream(reviewBuffer)
			eventStream.buildStarted("Coder rerun: addressing fix requirements")
			const text = await callLlmForText(api, systemPrompt, userMessage, taskId, abortSignal)
			const parsed = extractJsonFromText(text)
			eventStream.buildFinished("Coder rerun completed", JSON.stringify(parsed))
			return parsed
		}

		const reviewerExecutor = async (systemPrompt: string, userMessage: string): Promise<unknown> => {
			if (!api) throw new Error("PipelineController: ApiHandler required")
			await new Promise((resolve) => setTimeout(resolve, 100))
			const recentEvents = reviewBuffer.getEvents().map((e) => ({
				type: e.type,
				description: e.description,
				timestamp: e.timestamp,
			}))
			const { buildReviewerUserMessage } = await import("./prompts.js")
			const reviewerUserMessage = buildReviewerUserMessage({}, {}, {}, recentEvents)
			const text = await callLlmForText(api, systemPrompt, reviewerUserMessage, taskId, abortSignal)
			const parsed = extractJsonFromText(text)
			if (parsed && typeof parsed === "object" && "findings" in parsed) {
				for (const finding of (parsed as any).findings ?? []) {
					reviewBuffer.pushFinding({
						id: uuidv7(),
						severity: finding.severity ?? "suggestion",
						category: finding.category ?? "general",
						filePath: finding.filePath,
						line: finding.line,
						description: finding.description ?? "",
						recommendation: finding.recommendation ?? "",
						confidence: finding.confidence ?? 50,
						timestamp: Date.now(),
					})
				}
			}
			return parsed
		}

		const finalReviewExecutor = async (systemPrompt: string, userMessage: string): Promise<unknown> => {
			if (!api) throw new Error("PipelineController: ApiHandler required")
			const text = await callLlmForText(api, systemPrompt, userMessage, taskId, abortSignal)
			return extractJsonFromText(text)
		}

		const responseExecutor = async (systemPrompt: string, userMessage: string): Promise<unknown> => {
			if (!api) throw new Error("PipelineController: ApiHandler required")
			const text = await callLlmForText(api, systemPrompt, userMessage, taskId, abortSignal)
			return extractJsonFromText(text)
		}

		return [
			{ ...StageCoder.definition(), executor: coderExecutor, parallelGroup: "engineering" },
			{ ...StageReviewer.definition(), executor: reviewerExecutor, parallelGroup: "engineering" },
			{ ...StageFinalReview.definition(), executor: finalReviewExecutor },
			{ ...StageResponse.definition(), executor: responseExecutor },
		]
	}

	async run(config: PipelineControllerConfig): Promise<PipelineResult> {
		const pipelineId = uuidv7()
		const ctx: PipelineContext = {
			pipelineId,
			taskId: config.taskId,
			userMessage: config.userMessage,
			userImages: config.userImages,
			abortSignal: config.abortSignal,
			startTime: Date.now(),
			completedStages: [],
			currentStage: "(none)",
		}

		const reviewBuffer = new ReviewBuffer()
		if (config.onReviewFinding) {
			reviewBuffer.onFinding(config.onReviewFinding)
		}

		// Subscribe to events for progress reporting
		if (config.onProgress) {
			this.scheduler.getEventBus().subscribe((event) => {
				if (event.type === "StageStarted" && event.stageId) {
					config.onProgress!(event.stageId, "started")
				} else if (event.type === "StageFinished" && event.stageId) {
					config.onProgress!(event.stageId, "completed")
				} else if (event.type === "StageFailed" && event.stageId) {
					config.onProgress!(event.stageId, "failed")
				}
			})
		}

		let rerunCount = 0
		let finalOutcome: { ok: boolean; completedStages: string[]; failedStage?: string; error?: string }
		let allOutcomes: Awaited<ReturnType<PipelineScheduler["run"]>>

		// Outer loop: Boss can send Coder+Reviewer back for fixes
		// First run: all 7 stages. Subsequent runs: only stages 4-5 (engineering).
		let isFirstRun = true
		while (rerunCount <= MAX_RERUN_ATTEMPTS) {
			const stages = isFirstRun
				? this.buildStages(config, reviewBuffer)
				: this.buildEngineeringStages(config, reviewBuffer)
			allOutcomes = await this.scheduler.run(stages, ctx)
			isFirstRun = false

			// Store intermediate outputs in context
			for (const outcome of allOutcomes) {
				if (outcome.ok && outcome.output !== undefined) {
					this.storeOutcome(ctx, { stageId: outcome.stageId, output: outcome.output })
				}
			}

			// Check the Boss's decision
			const bossOutcome = allOutcomes.find((o) => o.stageId === "final-review")
			if (bossOutcome?.ok && bossOutcome.output) {
				const decision = (bossOutcome.output as any)?.decision
				if (decision === "needs_fixes" && rerunCount < MAX_RERUN_ATTEMPTS) {
					// Boss says needs fixes — rerun Coder + Reviewer
					rerunCount++
					// Clear the engineering stages from completed list
					ctx.completedStages = ctx.completedStages.filter(
						(s) => s !== "coder" && s !== "reviewer" && s !== "final-review" && s !== "response",
					)
					// Clear the review buffer for the new round
					reviewBuffer.clear()
					continue
				}
			}

			// Either approved, rejected, or max reruns reached
			break
		}

		const failed = allOutcomes!.find((o) => !o.ok)
		const completed = allOutcomes!.filter((o) => o.ok).map((o) => o.stageId)

		// Notify webview about completed stage outputs
		if (config.onStageOutput) {
			for (const outcome of allOutcomes!) {
				if (outcome.ok && outcome.output) {
					await config.onStageOutput(outcome.stageId, JSON.stringify(outcome.output, null, 2))
				}
			}
		}

		// Build final response
		let finalResponse: string
		if (failed) {
			finalResponse = `Pipeline halted at stage ${failed.stageId}: ${failed.error}`
		} else {
			const stageNames: Record<string, string> = {
				intent: "Intent Analysis",
				planner: "Requirements & Planning",
				architect: "Architecture Blueprint",
				coder: "Implementation",
				reviewer: "Live Review",
				"final-review": "Final Review",
				response: "Response",
			}
			const completedNames = completed.map((s) => stageNames[s] ?? s)
			const rerunMsg = rerunCount > 0 ? ` (${rerunCount} fix cycle${rerunCount > 1 ? "s" : ""})` : ""
			finalResponse = [
				`✅ **${completedNames.join(" → ")}**${rerunMsg} — Pipeline complete.`,
				``,
				ctx.finalResponse ? String(ctx.finalResponse) : "All stages completed successfully.",
			].join("\n")
		}

		return {
			pipelineId,
			taskId: config.taskId,
			ok: !failed,
			completedStages: completed,
			failedStage: failed?.stageId,
			error: failed?.error,
			finalResponse,
			blueprintArtifact: ctx.blueprintArtifact,
			codeArtifacts: ctx.codeArtifacts,
			reviewReport: ctx.reviewReport,
			approvalReport: ctx.approvalReport,
			finalResponseArtifact: ctx.finalResponse,
			rerunCount,
		}
	}

	private storeOutcome(ctx: PipelineContext, outcome: { stageId: string; output: unknown }): void {
		switch (outcome.stageId) {
			case "intent":
				ctx.intentArtifact = outcome.output
				break
			case "planner":
				ctx.requirementsArtifact = outcome.output
				break
			case "architect":
				ctx.blueprintArtifact = outcome.output
				break
			case "coder":
				ctx.codeArtifacts = outcome.output
				break
			case "reviewer":
				ctx.reviewReport = outcome.output
				break
			case "final-review":
				ctx.approvalReport = outcome.output
				break
			case "response":
				ctx.finalResponse = outcome.output
				break
		}
	}
}
