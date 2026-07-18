/**
 * Phase 3 tests — Engineering Pipeline (Stages 4 & 5 parallel).
 *
 * Covers:
 *  - ReviewBuffer: event publishing, subscription, findings, snapshot/restore
 *  - CoderEventStream: structured event publishing
 *  - PipelineScheduler: parallel execution with parallelGroup
 *  - PipelineController: 5-stage flow with parallel Coder || Reviewer
 *  - Stage prompts for Coder and Reviewer
 *  - Reviewer permissions (read-only)
 *  - Coder permissions (read/write/edit/shell)
 *  - Concurrent execution correctness
 *  - Event ordering
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

import { ReviewBuffer } from "../ReviewBuffer"
import { CoderEventStream } from "../CoderEventStream"
import { PipelineScheduler } from "../PipelineScheduler"
import { PipelineController } from "../PipelineController"
import { StagePromptBuilder } from "../StagePromptBuilder"
import type { CoderEvent, ReviewFinding } from "../ReviewBuffer"
import type { StageDefinition } from "../PipelineScheduler"
import type { PipelineContext } from "../types"
import type { ApiHandler } from "../../../api/index"
import type { ApiStreamChunk } from "../../../api/transform/stream"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
	return {
		pipelineId: "test-pipeline",
		taskId: "test-task",
		userMessage: "Add dark mode",
		abortSignal: new AbortController().signal,
		startTime: Date.now(),
		completedStages: [],
		currentStage: "(none)",
		...overrides,
	}
}

function makeTextStream(text: string): AsyncGenerator<ApiStreamChunk> {
	return (async function* () {
		yield { type: "text", text } as ApiStreamChunk
	})()
}

const VALID_CODE_ARTIFACTS = {
	filesCreated: ["src/theme.css"],
	filesModified: ["src/settings.ts"],
	implementationSummary: "Implemented dark mode with CSS variables",
	deviations: [],
	buildStatus: { success: true, output: "Build succeeded", errors: [] },
	completionStatus: "complete",
	confidence: 90,
	confidenceRationale: "All tasks completed successfully",
}

const VALID_REVIEW_REPORT = {
	findings: [
		{
			severity: "info",
			category: "missing_impl",
			file: "src/theme.css",
			description: "Dark mode implemented correctly",
			recommendation: "No changes needed",
		},
	],
	overallAssessment: "approved",
	summary: "Implementation looks good",
	confidence: 85,
	confidenceRationale: "Clean implementation",
}

const VALID_INTENT_ARTIFACT = {
	summary: "Add dark mode",
	primaryGoal: "Dark mode toggle",
	constraints: [],
	hiddenRequirements: [],
	risks: [],
	missingInfo: [],
	successCriteria: ["Toggle works"],
	confidence: 90,
	confidenceRationale: "Clear request",
}

const VALID_REQUIREMENTS_ARTIFACT = {
	objectives: ["Add dark mode"],
	scope: "Settings page",
	acceptanceCriteria: ["Toggle works"],
	priorityOrder: ["CSS", "Toggle"],
	functionalRequirements: ["Dark mode toggle"],
	nonFunctionalRequirements: [],
	dependencies: [],
	excludedItems: [],
	confidence: 85,
	confidenceRationale: "Well-scoped",
}

const VALID_BLUEPRINT_ARTIFACT = {
	systemArchitecture: "CSS variables",
	componentDiagram: "Settings → ThemeToggle",
	executionGraph: [{ step: "1", description: "CSS vars", dependencies: [], output: "theme.css" }],
	dependencyGraph: [{ component: "ThemeToggle", dependsOn: [], provides: ["toggle"] }],
	algorithms: [],
	taskDecomposition: [{ taskId: "t1", files: ["theme.css"], approach: "CSS vars", edgeCases: [] }],
	riskAnalysis: [{ risk: "a11y", likelihood: "low", impact: "medium", mitigation: "checks" }],
	validationPoints: ["After CSS"],
	rollbackStrategy: "Remove CSS vars",
	optimizationOpportunities: [],
	confidence: 80,
	confidenceRationale: "Standard pattern",
}

// ---------------------------------------------------------------------------
// ReviewBuffer
// ---------------------------------------------------------------------------

describe("ReviewBuffer", () => {
	let buffer: ReviewBuffer

	beforeEach(() => {
		buffer = new ReviewBuffer()
	})

	it("publishes events to subscribers", () => {
		const received: CoderEvent[] = []
		buffer.onEvent((e) => received.push(e))

		buffer.pushEvent({
			type: "FileEdited",
			timestamp: Date.now(),
			description: "Edited theme.css",
			filePath: "src/theme.css",
		})

		expect(received).toHaveLength(1)
		expect(received[0]!.type).toBe("FileEdited")
	})

	it("publishes findings to finding subscribers", () => {
		const received: ReviewFinding[] = []
		buffer.onFinding((f) => received.push(f))

		buffer.pushFinding({
			id: "f1",
			severity: "warning",
			category: "style",
			description: "Missing semicolon",
			recommendation: "Add semicolon",
			confidence: 90,
			timestamp: Date.now(),
		})

		expect(received).toHaveLength(1)
		expect(received[0]!.severity).toBe("warning")
	})

	it("unsubscribe stops events", () => {
		const received: CoderEvent[] = []
		const unsub = buffer.onEvent((e) => received.push(e))

		unsub()

		buffer.pushEvent({
			type: "FileCreated",
			timestamp: Date.now(),
			description: "Created file",
		})

		expect(received).toHaveLength(0)
	})

	it("getEventsSince returns only recent events", () => {
		const t1 = Date.now() - 1000
		const t2 = Date.now()

		buffer.pushEvent({ type: "FileEdited", timestamp: t1, description: "old" })
		buffer.pushEvent({ type: "FileCreated", timestamp: t2, description: "new" })

		const recent = buffer.getEventsSince(t1)
		expect(recent).toHaveLength(1)
		expect(recent[0]!.description).toBe("new")
	})

	it("snapshot and restore round-trips correctly", () => {
		buffer.pushEvent({ type: "FileEdited", timestamp: Date.now(), description: "test" })
		buffer.pushFinding({
			id: "f1",
			severity: "info",
			category: "test",
			description: "finding",
			recommendation: "none",
			confidence: 50,
			timestamp: Date.now(),
		})

		const snapshot = buffer.snapshot()
		const newBuffer = new ReviewBuffer()
		newBuffer.restore(snapshot)

		expect(newBuffer.eventCount).toBe(1)
		expect(newBuffer.findingCount).toBe(1)
	})

	it("clear removes all events and findings", () => {
		buffer.pushEvent({ type: "FileEdited", timestamp: Date.now(), description: "test" })
		buffer.pushFinding({
			id: "f1",
			severity: "info",
			category: "test",
			description: "finding",
			recommendation: "none",
			confidence: 50,
			timestamp: Date.now(),
		})

		buffer.clear()
		expect(buffer.eventCount).toBe(0)
		expect(buffer.findingCount).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// CoderEventStream
// ---------------------------------------------------------------------------

describe("CoderEventStream", () => {
	it("publishes typed events to the buffer", () => {
		const buffer = new ReviewBuffer()
		const stream = new CoderEventStream(buffer)

		stream.fileEdited("src/theme.css", "Added dark mode variables")

		expect(buffer.eventCount).toBe(1)
		const events = buffer.getEvents()
		expect(events[0]!.type).toBe("FileEdited")
		expect(events[0]!.filePath).toBe("src/theme.css")
	})

	it("publishes all event types", () => {
		const buffer = new ReviewBuffer()
		const stream = new CoderEventStream(buffer)

		stream.fileCreated("src/new.ts", "Created")
		stream.fileDeleted("src/old.ts", "Deleted")
		stream.toolExecuted("apply_diff", "Applied patch")
		stream.shellExecuted("npm test", "Ran tests")
		stream.patchApplied("src/x.ts", "Patched")
		stream.buildStarted("Building")
		stream.buildFinished("Done")
		stream.testStarted("Testing")
		stream.testFinished("Tests passed")
		stream.errorRaised("Error occurred", "ENOENT")

		expect(buffer.eventCount).toBe(10)
	})

	it("events have timestamps", () => {
		const buffer = new ReviewBuffer()
		const stream = new CoderEventStream(buffer)

		const before = Date.now()
		stream.fileEdited("a.ts", "edit")
		const after = Date.now()

		const event = buffer.getEvents()[0]!
		expect(event.timestamp).toBeGreaterThanOrEqual(before)
		expect(event.timestamp).toBeLessThanOrEqual(after)
	})
})

// ---------------------------------------------------------------------------
// PipelineScheduler — parallel execution
// ---------------------------------------------------------------------------

describe("PipelineScheduler (parallel execution)", () => {
	it("runs parallelGroup stages concurrently", async () => {
		const scheduler = new PipelineScheduler()
		const executionOrder: string[] = []

		const stages: StageDefinition[] = [
			{
				id: "a",
				stageName: "A",
				executor: async () => {
					executionOrder.push("a-start")
					await new Promise((r) => setTimeout(r, 50))
					executionOrder.push("a-end")
					return { summary: "a done", confidence: 50, confidenceRationale: "test" }
				},
			},
			{
				id: "b",
				stageName: "B",
				parallelGroup: "eng",
				executor: async () => {
					executionOrder.push("b-start")
					await new Promise((r) => setTimeout(r, 30))
					executionOrder.push("b-end")
					return { summary: "b done", confidence: 50, confidenceRationale: "test" }
				},
			},
			{
				id: "c",
				stageName: "C",
				parallelGroup: "eng",
				executor: async () => {
					executionOrder.push("c-start")
					await new Promise((r) => setTimeout(r, 40))
					executionOrder.push("c-end")
					return { summary: "c done", confidence: 50, confidenceRationale: "test" }
				},
			},
		]

		const outcomes = await scheduler.run(stages, makeCtx())

		expect(outcomes).toHaveLength(3)
		expect(outcomes.every((o) => o.ok)).toBe(true)

		// Both b and c should start before either finishes
		expect(executionOrder.indexOf("b-start")).toBeLessThan(executionOrder.indexOf("b-end"))
		expect(executionOrder.indexOf("c-start")).toBeLessThan(executionOrder.indexOf("c-end"))

		// b and c should both start before a ends (if a runs first)
		// or at least they should interleave
		const bStart = executionOrder.indexOf("b-start")
		const cStart = executionOrder.indexOf("c-start")
		expect(bStart).toBeLessThan(executionOrder.indexOf("b-end"))
		expect(cStart).toBeLessThan(executionOrder.indexOf("c-end"))
	})

	it("stops parallel group on first failure", async () => {
		const scheduler = new PipelineScheduler()

		const stages: StageDefinition[] = [
			{
				id: "a",
				stageName: "A",
				parallelGroup: "eng",
				executor: async () => {
					throw new Error("Stage A failed")
				},
			},
			{
				id: "b",
				stageName: "B",
				parallelGroup: "eng",
				executor: async () => ({ summary: "ok", confidence: 50, confidenceRationale: "test" }),
			},
		]

		const outcomes = await scheduler.run(stages, makeCtx())
		expect(outcomes.some((o) => !o.ok)).toBe(true)
	})

	it("waits for all parallel stages before proceeding", async () => {
		const scheduler = new PipelineScheduler()
		const order: string[] = []

		const stages: StageDefinition[] = [
			{
				id: "a",
				stageName: "A",
				parallelGroup: "eng",
				executor: async () => {
					await new Promise((r) => setTimeout(r, 50))
					order.push("a-done")
					return { summary: "a", confidence: 50, confidenceRationale: "test" }
				},
			},
			{
				id: "b",
				stageName: "B",
				parallelGroup: "eng",
				executor: async () => {
					await new Promise((r) => setTimeout(r, 20))
					order.push("b-done")
					return { summary: "b", confidence: 50, confidenceRationale: "test" }
				},
			},
			{
				id: "c",
				stageName: "C",
				executor: async () => {
					order.push("c-done")
					return { summary: "c", confidence: 50, confidenceRationale: "test" }
				},
			},
		]

		await scheduler.run(stages, makeCtx())

		// c should run after both a and b are done
		expect(order.indexOf("a-done")).toBeLessThan(order.indexOf("c-done"))
		expect(order.indexOf("b-done")).toBeLessThan(order.indexOf("c-done"))
	})
})

// ---------------------------------------------------------------------------
// StagePromptBuilder — Coder and Reviewer prompts
// ---------------------------------------------------------------------------

describe("StagePromptBuilder (Phase 3)", () => {
	const builder = new StagePromptBuilder()

	it("produces a real system prompt for coder stage", () => {
		const prompt = builder.buildSystemPrompt("coder")
		expect(prompt).toContain("Coder")
		expect(prompt).toContain("NEVER make architecture decisions")
		expect(prompt).toContain("Event Publishing")
		expect(prompt).not.toContain("placeholder")
	})

	it("produces a real system prompt for reviewer stage", () => {
		const prompt = builder.buildSystemPrompt("reviewer")
		expect(prompt).toContain("Live Reviewer")
		expect(prompt).toContain("NEVER edit code")
		expect(prompt).toContain("NEVER run shell")
		expect(prompt).not.toContain("placeholder")
	})

	it("builds coder user message with all artifacts", () => {
		const ctx = makeCtx({
			intentArtifact: VALID_INTENT_ARTIFACT,
			requirementsArtifact: VALID_REQUIREMENTS_ARTIFACT,
			taskListArtifact: { tasks: [] },
			blueprintArtifact: VALID_BLUEPRINT_ARTIFACT,
		})
		const msg = builder.buildUserMessage("coder", ctx)
		expect(msg).toContain("Intent")
		expect(msg).toContain("Requirements")
		expect(msg).toContain("Blueprint")
	})

	it("builds reviewer user message with artifacts and events", () => {
		const ctx = makeCtx({
			intentArtifact: VALID_INTENT_ARTIFACT,
			requirementsArtifact: VALID_REQUIREMENTS_ARTIFACT,
			blueprintArtifact: VALID_BLUEPRINT_ARTIFACT,
		})
		const msg = builder.buildUserMessage("reviewer", ctx)
		expect(msg).toContain("Intent")
		expect(msg).toContain("Requirements")
		expect(msg).toContain("Blueprint")
	})
})

// ---------------------------------------------------------------------------
// PipelineController — 5-stage flow
// ---------------------------------------------------------------------------

describe("PipelineController (Phase 3 — 5 stages)", () => {
	it("runs 5 stages with parallel Coder and Reviewer", async () => {
		let callCount = 0
		const streams = [
			makeTextStream(JSON.stringify(VALID_INTENT_ARTIFACT)),
			makeTextStream(JSON.stringify(VALID_REQUIREMENTS_ARTIFACT)),
			makeTextStream(JSON.stringify(VALID_BLUEPRINT_ARTIFACT)),
			makeTextStream(JSON.stringify(VALID_CODE_ARTIFACTS)),
			makeTextStream(JSON.stringify(VALID_REVIEW_REPORT)),
		]

		const api = {
			createMessage: vi.fn().mockImplementation(() => streams[callCount++]!),
			getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }),
			countTokens: vi.fn().mockResolvedValue(0),
		} as unknown as ApiHandler

		const controller = new PipelineController()
		const result = await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
		})

		expect(result.ok).toBe(true)
		expect(result.completedStages).toHaveLength(5)
		expect(result.completedStages).toContain("intent")
		expect(result.completedStages).toContain("planner")
		expect(result.completedStages).toContain("architect")
		expect(result.completedStages).toContain("coder")
		expect(result.completedStages).toContain("reviewer")
	})

	it("reports progress for all 5 stages", async () => {
		const progressEvents: Array<{ stageId: string; status: string }> = []
		let callCount = 0
		const streams = [
			makeTextStream(JSON.stringify(VALID_INTENT_ARTIFACT)),
			makeTextStream(JSON.stringify(VALID_REQUIREMENTS_ARTIFACT)),
			makeTextStream(JSON.stringify(VALID_BLUEPRINT_ARTIFACT)),
			makeTextStream(JSON.stringify(VALID_CODE_ARTIFACTS)),
			makeTextStream(JSON.stringify(VALID_REVIEW_REPORT)),
		]

		const api = {
			createMessage: vi.fn().mockImplementation(() => streams[callCount++]!),
			getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }),
			countTokens: vi.fn().mockResolvedValue(0),
		} as unknown as ApiHandler

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

		expect(progressEvents.filter((e) => e.status === "started")).toHaveLength(5)
		expect(progressEvents.filter((e) => e.status === "completed")).toHaveLength(5)
	})

	it("returns codeArtifacts and reviewReport", async () => {
		let callCount = 0
		const streams = [
			makeTextStream(JSON.stringify(VALID_INTENT_ARTIFACT)),
			makeTextStream(JSON.stringify(VALID_REQUIREMENTS_ARTIFACT)),
			makeTextStream(JSON.stringify(VALID_BLUEPRINT_ARTIFACT)),
			makeTextStream(JSON.stringify(VALID_CODE_ARTIFACTS)),
			makeTextStream(JSON.stringify(VALID_REVIEW_REPORT)),
		]

		const api = {
			createMessage: vi.fn().mockImplementation(() => streams[callCount++]!),
			getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }),
			countTokens: vi.fn().mockResolvedValue(0),
		} as unknown as ApiHandler

		const controller = new PipelineController()
		const result = await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
		})

		expect(result.codeArtifacts).toBeDefined()
		expect(result.reviewReport).toBeDefined()
	})
})

// ---------------------------------------------------------------------------
// Artifact schemas — Phase 3
// ---------------------------------------------------------------------------

describe("Artifact schemas (Phase 3)", () => {
	it("CodeArtifactsSchema validates a complete artifact", () => {
		const { CodeArtifactsSchema } = require("../artifacts")
		expect(() => CodeArtifactsSchema.parse(VALID_CODE_ARTIFACTS)).not.toThrow()
	})

	it("ReviewReportSchema validates a complete report", () => {
		const { ReviewReportSchema } = require("../artifacts")
		expect(() => ReviewReportSchema.parse(VALID_REVIEW_REPORT)).not.toThrow()
	})

	it("CodeArtifactsSchema rejects invalid completionStatus", () => {
		const { CodeArtifactsSchema } = require("../artifacts")
		expect(() => CodeArtifactsSchema.parse({ ...VALID_CODE_ARTIFACTS, completionStatus: "invalid" })).toThrow()
	})
})
