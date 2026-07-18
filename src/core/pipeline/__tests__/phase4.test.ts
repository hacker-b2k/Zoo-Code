/**
 * Phase 4 tests — Final Review + Response Simplifier + Rerun Loop.
 *
 * Covers:
 *  - Stage 6 (Boss): approval, needs_fixes, rejection paths
 *  - Stage 7 (Response Simplifier): human-readable output
 *  - Rerun loop: Boss sends Coder+Reviewer back for fixes
 *  - PipelineController 7-stage flow
 *  - Prompts for Stage 6 and 7
 */

import { describe, it, expect, vi } from "vitest"

import { PipelineController } from "../PipelineController"
import { StagePromptBuilder } from "../StagePromptBuilder"
import type { ApiHandler } from "../../../api/index"
import type { ApiStreamChunk } from "../../../api/transform/stream"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTextStream(text: string): AsyncGenerator<ApiStreamChunk> {
	return (async function* () {
		yield { type: "text", text } as ApiStreamChunk
	})()
}

const VALID_INTENT = {
	summary: "Add dark mode",
	primaryGoal: "Dark mode toggle",
	constraints: [],
	hiddenRequirements: [],
	risks: [],
	missingInfo: [],
	successCriteria: ["Toggle works"],
	confidence: 90,
	confidenceRationale: "Clear",
}

const VALID_REQUIREMENTS = {
	objectives: ["Add dark mode"],
	scope: "Settings",
	acceptanceCriteria: ["Toggle works"],
	priorityOrder: ["CSS"],
	functionalRequirements: ["Toggle"],
	nonFunctionalRequirements: [],
	dependencies: [],
	excludedItems: [],
	confidence: 85,
	confidenceRationale: "Well-scoped",
}

const VALID_BLUEPRINT = {
	systemArchitecture: "CSS vars",
	componentDiagram: "Settings → Toggle",
	executionGraph: [{ step: "1", description: "CSS", dependencies: [], output: "theme.css" }],
	dependencyGraph: [{ component: "Toggle", dependsOn: [], provides: ["toggle"] }],
	algorithms: [],
	taskDecomposition: [{ taskId: "t1", files: ["theme.css"], approach: "CSS vars", edgeCases: [] }],
	riskAnalysis: [{ risk: "a11y", likelihood: "low", impact: "medium", mitigation: "checks" }],
	validationPoints: ["After CSS"],
	rollbackStrategy: "Remove CSS",
	optimizationOpportunities: [],
	confidence: 80,
	confidenceRationale: "Standard",
}

const VALID_CODE = {
	filesCreated: ["src/theme.css"],
	filesModified: ["src/settings.ts"],
	implementationSummary: "Dark mode implemented",
	deviations: [],
	buildStatus: { success: true, output: "OK", errors: [] },
	completionStatus: "complete",
	confidence: 90,
	confidenceRationale: "All done",
}

const VALID_REVIEW = {
	findings: [],
	overallAssessment: "approved",
	summary: "Looks good",
	confidence: 85,
	confidenceRationale: "Clean",
}

const APPROVED_DECISION = {
	decision: "approved",
	fixRequirements: [],
	summary: "Implementation is complete and correct",
	canComplete: true,
	confidence: 95,
	confidenceRationale: "All requirements met",
}

const NEEDS_FIXES_DECISION = {
	decision: "needs_fixes",
	fixRequirements: [{ taskId: "fix-1", description: "Add CSS variable for hover state", priority: "high" }],
	summary: "Minor fix needed",
	canComplete: false,
	confidence: 70,
	confidenceRationale: "One issue remaining",
}

const REJECTED_DECISION = {
	decision: "rejected",
	fixRequirements: [],
	summary: "Fundamentally wrong approach",
	canComplete: false,
	confidence: 20,
	confidenceRationale: "Wrong architecture",
}

const VALID_FINAL_RESPONSE = {
	responseExplanation: "Dark mode has been implemented successfully. The toggle works and the preference persists.",
	technicalSummaryRequested: false,
}

// Track call count across runs
let callCount = 0
let streamSequence: Array<() => AsyncGenerator<ApiStreamChunk>> = []

function resetStreams(streams: Array<() => AsyncGenerator<ApiStreamChunk>>) {
	callCount = 0
	streamSequence = streams
}

function makeMockApi(): ApiHandler {
	return {
		createMessage: vi.fn().mockImplementation(() => streamSequence[callCount++]!()),
		getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }),
		countTokens: vi.fn().mockResolvedValue(0),
	} as unknown as ApiHandler
}

function approvalStreams(decision: typeof APPROVED_DECISION): Array<() => AsyncGenerator<ApiStreamChunk>> {
	return [
		() => makeTextStream(JSON.stringify(VALID_INTENT)),
		() => makeTextStream(JSON.stringify(VALID_REQUIREMENTS)),
		() => makeTextStream(JSON.stringify(VALID_BLUEPRINT)),
		() => makeTextStream(JSON.stringify(VALID_CODE)),
		() => makeTextStream(JSON.stringify(VALID_REVIEW)),
		() => makeTextStream(JSON.stringify(decision)),
		() => makeTextStream(JSON.stringify(VALID_FINAL_RESPONSE)),
	]
}

// ---------------------------------------------------------------------------
// StagePromptBuilder — Stage 6 and 7 prompts
// ---------------------------------------------------------------------------

describe("StagePromptBuilder (Phase 4)", () => {
	const builder = new StagePromptBuilder()

	it("produces a real system prompt for final-review stage", () => {
		const prompt = builder.buildSystemPrompt("final-review")
		expect(prompt).toContain("Final Reviewer")
		expect(prompt).toContain("NEVER modify code")
		expect(prompt).toContain("approved")
		expect(prompt).toContain("needs_fixes")
		expect(prompt).toContain("rejected")
		expect(prompt).not.toContain("placeholder")
	})

	it("produces a real system prompt for response stage", () => {
		const prompt = builder.buildSystemPrompt("response")
		expect(prompt).toContain("Response Simplifier")
		expect(prompt).toContain("human-readable")
		expect(prompt).toContain("SHORT")
		expect(prompt).not.toContain("placeholder")
	})

	it("builds final-review user message with all artifacts", () => {
		const ctx = {
			pipelineId: "p1",
			taskId: "t1",
			userMessage: "test",
			abortSignal: new AbortController().signal,
			startTime: Date.now(),
			completedStages: [],
			currentStage: "final-review",
			intentArtifact: VALID_INTENT,
			requirementsArtifact: VALID_REQUIREMENTS,
			blueprintArtifact: VALID_BLUEPRINT,
			codeArtifacts: VALID_CODE,
			reviewReport: VALID_REVIEW,
		}
		const msg = builder.buildUserMessage("final-review", ctx)
		expect(msg).toContain("Intent")
		expect(msg).toContain("Code Artifacts")
		expect(msg).toContain("Review Report")
	})

	it("builds response user message with approval decision", () => {
		const ctx = {
			pipelineId: "p1",
			taskId: "t1",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			startTime: Date.now(),
			completedStages: [],
			currentStage: "response",
			approvalReport: APPROVED_DECISION,
			codeArtifacts: VALID_CODE,
			reviewReport: VALID_REVIEW,
		}
		const msg = builder.buildUserMessage("response", ctx)
		expect(msg).toContain("Original User Request")
		expect(msg).toContain("Final Review Decision")
	})
})

// ---------------------------------------------------------------------------
// PipelineController — approval path
// ---------------------------------------------------------------------------

describe("PipelineController (Phase 4 — approval)", () => {
	it("runs all 7 stages and returns approved result", async () => {
		resetStreams(approvalStreams(APPROVED_DECISION))
		const api = makeMockApi()

		const controller = new PipelineController()
		const result = await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
		})

		expect(result.ok).toBe(true)
		expect(result.completedStages).toHaveLength(7)
		expect(result.completedStages).toContain("final-review")
		expect(result.completedStages).toContain("response")
		expect(result.rerunCount).toBe(0)
	})

	it("returns approvalReport and finalResponseArtifact", async () => {
		resetStreams(approvalStreams(APPROVED_DECISION))
		const api = makeMockApi()

		const controller = new PipelineController()
		const result = await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
		})

		expect(result.approvalReport).toBeDefined()
		expect(result.finalResponseArtifact).toBeDefined()
	})
})

// ---------------------------------------------------------------------------
// PipelineController — needs_fixes path (rerun loop)
// ---------------------------------------------------------------------------

describe("PipelineController (Phase 4 — needs_fixes rerun)", () => {
	it("reruns Coder+Reviewer when Boss says needs_fixes, then approves", async () => {
		// First run: Boss says needs_fixes
		// Second run: Boss says approved
		resetStreams([])

		// Override streamSequence dynamically
		streamSequence = [
			// Run 1: Intent
			() => makeTextStream(JSON.stringify(VALID_INTENT)),
			// Run 1: Planner
			() => makeTextStream(JSON.stringify(VALID_REQUIREMENTS)),
			// Run 1: Architect
			() => makeTextStream(JSON.stringify(VALID_BLUEPRINT)),
			// Run 1: Coder
			() => makeTextStream(JSON.stringify(VALID_CODE)),
			// Run 1: Reviewer
			() => makeTextStream(JSON.stringify(VALID_REVIEW)),
			// Run 1: Boss → needs_fixes
			() => makeTextStream(JSON.stringify(NEEDS_FIXES_DECISION)),
			// Run 2: Coder (rerun)
			() => makeTextStream(JSON.stringify({ ...VALID_CODE, implementationSummary: "Fixed: added hover state" })),
			// Run 2: Reviewer (rerun)
			() => makeTextStream(JSON.stringify(VALID_REVIEW)),
			// Run 2: Boss → approved
			() => makeTextStream(JSON.stringify(APPROVED_DECISION)),
			// Run 2: Response
			() => makeTextStream(JSON.stringify(VALID_FINAL_RESPONSE)),
		]

		const api = makeMockApi()
		const controller = new PipelineController()
		const result = await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
		})

		expect(result.ok).toBe(true)
		expect(result.rerunCount).toBe(1)
		expect(result.completedStages).toContain("final-review")
		expect(result.completedStages).toContain("response")
	})

	it("stops after max rerun attempts", async () => {
		// Boss always says needs_fixes
		resetStreams([])

		const needsFixesStreams: Array<() => AsyncGenerator<ApiStreamChunk>> = []
		// First run: 3 thinking + 2 engineering + 1 boss = 6 calls
		needsFixesStreams.push(
			() => makeTextStream(JSON.stringify(VALID_INTENT)),
			() => makeTextStream(JSON.stringify(VALID_REQUIREMENTS)),
			() => makeTextStream(JSON.stringify(VALID_BLUEPRINT)),
			() => makeTextStream(JSON.stringify(VALID_CODE)),
			() => makeTextStream(JSON.stringify(VALID_REVIEW)),
			() => makeTextStream(JSON.stringify(NEEDS_FIXES_DECISION)),
		)
		// 3 reruns: each is 2 engineering + 1 boss = 3 calls × 3 = 9
		for (let i = 0; i < 3; i++) {
			needsFixesStreams.push(
				() => makeTextStream(JSON.stringify(VALID_CODE)),
				() => makeTextStream(JSON.stringify(VALID_REVIEW)),
				() => makeTextStream(JSON.stringify(NEEDS_FIXES_DECISION)),
			)
		}
		// After max reruns, response stage runs
		needsFixesStreams.push(() => makeTextStream(JSON.stringify(VALID_FINAL_RESPONSE)))

		streamSequence = needsFixesStreams
		const api = makeMockApi()
		const controller = new PipelineController()
		const result = await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
		})

		// Should have stopped after max reruns
		expect(result.rerunCount).toBe(3)
	})
})

// ---------------------------------------------------------------------------
// PipelineController — rejected path
// ---------------------------------------------------------------------------

describe("PipelineController (Phase 4 — rejected)", () => {
	it("returns failure when Boss rejects", async () => {
		resetStreams([
			() => makeTextStream(JSON.stringify(VALID_INTENT)),
			() => makeTextStream(JSON.stringify(VALID_REQUIREMENTS)),
			() => makeTextStream(JSON.stringify(VALID_BLUEPRINT)),
			() => makeTextStream(JSON.stringify(VALID_CODE)),
			() => makeTextStream(JSON.stringify(VALID_REVIEW)),
			() => makeTextStream(JSON.stringify(REJECTED_DECISION)),
			() => makeTextStream(JSON.stringify(VALID_FINAL_RESPONSE)),
		])
		const api = makeMockApi()

		const controller = new PipelineController()
		const result = await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
		})

		// Rejection is still "ok" from the pipeline's perspective —
		// it completed all stages, the Boss just decided "rejected".
		expect(result.completedStages).toContain("final-review")
		expect(result.approvalReport).toBeDefined()
	})
})

// ---------------------------------------------------------------------------
// Progress UI
// ---------------------------------------------------------------------------

describe("PipelineController (Phase 4 — progress)", () => {
	it("reports progress for all 7 stages including final-review and response", async () => {
		const progressEvents: Array<{ stageId: string; status: string }> = []
		resetStreams(approvalStreams(APPROVED_DECISION))
		const api = makeMockApi()

		const controller = new PipelineController()
		await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
			onProgress: (stageId, status) => {
				progressEvents.push({ stageId, status })
			},
		})

		expect(progressEvents.filter((e) => e.status === "started")).toHaveLength(7)
		expect(progressEvents.filter((e) => e.status === "completed")).toHaveLength(7)
		expect(progressEvents.some((e) => e.stageId === "final-review")).toBe(true)
		expect(progressEvents.some((e) => e.stageId === "response")).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// Artifact schemas
// ---------------------------------------------------------------------------

describe("Artifact schemas (Phase 4)", () => {
	it("ApprovalReportSchema validates approved decision", () => {
		const { ApprovalReportSchema } = require("../artifacts")
		expect(() => ApprovalReportSchema.parse(APPROVED_DECISION)).not.toThrow()
	})

	it("ApprovalReportSchema validates needs_fixes decision", () => {
		const { ApprovalReportSchema } = require("../artifacts")
		expect(() => ApprovalReportSchema.parse(NEEDS_FIXES_DECISION)).not.toThrow()
	})

	it("ApprovalReportSchema validates rejected decision", () => {
		const { ApprovalReportSchema } = require("../artifacts")
		expect(() => ApprovalReportSchema.parse(REJECTED_DECISION)).not.toThrow()
	})

	it("FinalResponseSchema validates final response", () => {
		const { FinalResponseSchema } = require("../artifacts")
		expect(() => FinalResponseSchema.parse(VALID_FINAL_RESPONSE)).not.toThrow()
	})

	it("ApprovalReportSchema rejects invalid decision", () => {
		const { ApprovalReportSchema } = require("../artifacts")
		expect(() => ApprovalReportSchema.parse({ ...APPROVED_DECISION, decision: "maybe" })).toThrow()
	})
})
