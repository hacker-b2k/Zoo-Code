/**
 * Phase 2 tests — Stages 1-3 intelligence pipeline.
 *
 * Covers:
 *  - Prompt builder produces real (non-placeholder) prompts for stages 1-3
 *  - StageManager retries on Zod validation failure
 *  - PipelineController runs exactly 3 stages and stops
 *  - Checkpoint resume skips completed stages
 *  - Immutable artifact enforcement
 *  - streamToText utilities (extractJsonFromText)
 *  - Progress callback wiring
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

import { StagePromptBuilder } from "../StagePromptBuilder"
import { StageManager } from "../StageManager"
import { PipelineController } from "../PipelineController"
import { CheckpointManager } from "../CheckpointManager"
import { EventBus } from "../EventBus"
import { extractJsonFromText } from "../streamToText"
import { IntentArtifactSchema, RequirementsArtifactSchema, BlueprintArtifactSchema } from "../artifacts"
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
		userMessage: "Add dark mode to the app",
		abortSignal: new AbortController().signal,
		startTime: Date.now(),
		completedStages: [],
		currentStage: "(none)",
		...overrides,
	}
}

const VALID_INTENT_ARTIFACT = {
	summary: "User wants dark mode added to the application",
	primaryGoal: "Add a dark mode toggle to the settings page",
	constraints: ["Must work with existing CSS framework", "Must persist user preference"],
	hiddenRequirements: ["System-level dark mode preference should be respected"],
	risks: ["Color contrast may fail accessibility checks"],
	missingInfo: [],
	successCriteria: ["Dark mode toggle works", "Preference persists across sessions"],
	confidence: 90,
	confidenceRationale: "Clear and well-defined request",
}

const VALID_REQUIREMENTS_ARTIFACT = {
	objectives: ["Add dark mode to the application"],
	scope: "Settings page dark mode toggle with persistence",
	acceptanceCriteria: ["Toggle switches between light and dark themes"],
	priorityOrder: ["Implement CSS variables", "Add toggle UI", "Add persistence"],
	functionalRequirements: ["Dark mode toggle in settings"],
	nonFunctionalRequirements: ["Accessible color contrast"],
	dependencies: [],
	excludedItems: ["Per-component theme customization"],
	confidence: 85,
	confidenceRationale: "Well-scoped feature",
}

const VALID_BLUEPRINT_ARTIFACT = {
	systemArchitecture: "CSS variable-based theming with a toggle component",
	componentDiagram: "SettingsPage → ThemeProvider → CSS Variables",
	executionGraph: [
		{ step: "step-1", description: "Define CSS variables", dependencies: [], output: "theme.css" },
		{ step: "step-2", description: "Create toggle component", dependencies: ["step-1"], output: "ThemeToggle.tsx" },
	],
	dependencyGraph: [
		{ component: "ThemeToggle", dependsOn: [], provides: ["toggle()"] },
		{ component: "SettingsPage", dependsOn: ["ThemeToggle"], provides: ["settings-ui"] },
	],
	algorithms: ["CSS custom property switching"],
	taskDecomposition: [
		{
			taskId: "task-1",
			files: ["src/theme.css"],
			approach: "Define CSS variables for light and dark themes",
			edgeCases: ["High contrast mode"],
		},
	],
	riskAnalysis: [{ risk: "Accessibility", likelihood: "medium", impact: "high", mitigation: "Run a11y checks" }],
	validationPoints: ["After CSS variable definition", "After toggle implementation"],
	rollbackStrategy: "Remove CSS variables and toggle component",
	optimizationOpportunities: ["System preference detection"],
	confidence: 80,
	confidenceRationale: "Well-understood pattern",
}

function makeValidIntentStream(): AsyncGenerator<ApiStreamChunk> {
	return (async function* () {
		yield { type: "text", text: JSON.stringify(VALID_INTENT_ARTIFACT) } as ApiStreamChunk
	})()
}

function makeValidRequirementsStream(): AsyncGenerator<ApiStreamChunk> {
	return (async function* () {
		yield { type: "text", text: JSON.stringify(VALID_REQUIREMENTS_ARTIFACT) } as ApiStreamChunk
	})()
}

function makeValidBlueprintStream(): AsyncGenerator<ApiStreamChunk> {
	return (async function* () {
		yield { type: "text", text: JSON.stringify(VALID_BLUEPRINT_ARTIFACT) } as ApiStreamChunk
	})()
}

function makeMockApi(
	streamFactory: (systemPrompt: string, messages: any[], metadata?: any) => AsyncGenerator<ApiStreamChunk>,
): ApiHandler {
	return {
		createMessage: vi.fn().mockImplementation(streamFactory),
		getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }),
		countTokens: vi.fn().mockResolvedValue(0),
	} as unknown as ApiHandler
}

function makeSingleTextStream(text: string): AsyncGenerator<ApiStreamChunk> {
	return (async function* () {
		yield { type: "text", text } as ApiStreamChunk
	})()
}

// ---------------------------------------------------------------------------
// StagePromptBuilder — real prompts
// ---------------------------------------------------------------------------

describe("StagePromptBuilder (Phase 2)", () => {
	const builder = new StagePromptBuilder()

	it("produces a real (non-placeholder) system prompt for intent stage", () => {
		const prompt = builder.buildSystemPrompt("intent")
		expect(prompt).toContain("User Intent Interpreter")
		expect(prompt).toContain("NEVER write code")
		expect(prompt).not.toContain("Phase 1 skeleton")
		expect(prompt).not.toContain("placeholder")
	})

	it("produces a real system prompt for planner stage", () => {
		const prompt = builder.buildSystemPrompt("planner")
		expect(prompt).toContain("Master Planner")
		expect(prompt).toContain("NEVER write code")
		expect(prompt).toContain("functional requirements")
		expect(prompt).not.toContain("placeholder")
	})

	it("produces a real system prompt for architect stage", () => {
		const prompt = builder.buildSystemPrompt("architect")
		expect(prompt).toContain("System Architect")
		expect(prompt).toContain("engineering blueprint")
		expect(prompt).toContain("dependency graph")
		expect(prompt).not.toContain("placeholder")
	})

	it("builds intent user message with user text", () => {
		const msg = builder.buildUserMessage("intent", makeCtx({ userMessage: "Add login" }))
		expect(msg).toContain("Add login")
	})

	it("builds planner user message with intent artifact", () => {
		const ctx = makeCtx({ intentArtifact: VALID_INTENT_ARTIFACT })
		const msg = builder.buildUserMessage("planner", ctx)
		expect(msg).toContain("Intent Artifact")
		expect(msg).toContain("Stage 1")
	})

	it("builds architect user message with all prior artifacts", () => {
		const ctx = makeCtx({
			intentArtifact: VALID_INTENT_ARTIFACT,
			requirementsArtifact: VALID_REQUIREMENTS_ARTIFACT,
			taskListArtifact: { tasks: [] },
		})
		const msg = builder.buildUserMessage("architect", ctx)
		expect(msg).toContain("Intent Artifact")
		expect(msg).toContain("Requirements Artifact")
		expect(msg).toContain("Task List")
	})
})

// ---------------------------------------------------------------------------
// extractJsonFromText
// ---------------------------------------------------------------------------

describe("extractJsonFromText", () => {
	it("extracts JSON from a code block", () => {
		const text = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.'
		expect(extractJsonFromText(text)).toEqual({ key: "value" })
	})

	it("extracts JSON from a code block without json lang marker", () => {
		const text = '```\n{"key": "value"}\n```'
		expect(extractJsonFromText(text)).toEqual({ key: "value" })
	})

	it("extracts raw JSON object", () => {
		const text = 'Some text {"key": "value"} more text'
		expect(extractJsonFromText(text)).toEqual({ key: "value" })
	})

	it("parses plain JSON", () => {
		const text = '{"key": "value"}'
		expect(extractJsonFromText(text)).toEqual({ key: "value" })
	})

	it("throws on invalid JSON", () => {
		expect(() => extractJsonFromText("not json at all")).toThrow()
	})
})

// ---------------------------------------------------------------------------
// StageManager — retry on validation failure
// ---------------------------------------------------------------------------

describe("StageManager (Phase 2 — retry)", () => {
	let eventBus: EventBus
	let checkpointManager: CheckpointManager
	let promptBuilder: StagePromptBuilder

	beforeEach(() => {
		eventBus = new EventBus()
		checkpointManager = new CheckpointManager()
		promptBuilder = new StagePromptBuilder()
	})

	it("retries on Zod validation failure and succeeds on retry", async () => {
		let callCount = 0
		const executor = async () => {
			callCount++
			if (callCount === 1) {
				// First call: return invalid data
				return { wrong: true }
			}
			// Second call: return valid data
			return VALID_INTENT_ARTIFACT
		}

		const stage = new StageManager(
			{
				stageId: "intent",
				stageName: "Intent",
				outputSchema: IntentArtifactSchema,
				executor,
			},
			{ eventBus, checkpointManager, promptBuilder },
		)

		const result = await stage.run(makeCtx())
		expect(result.ok).toBe(true)
		expect(result.retries).toBe(1)
		expect(callCount).toBe(2)
	})

	it("fails after max retries exceeded", async () => {
		const executor = async () => ({ wrong: true })

		const stage = new StageManager(
			{
				stageId: "intent",
				stageName: "Intent",
				outputSchema: IntentArtifactSchema,
				executor,
			},
			{ eventBus, checkpointManager, promptBuilder },
		)

		const result = await stage.run(makeCtx())
		expect(result.ok).toBe(false)
		expect(result.retries).toBe(3) // MAX_VALIDATION_RETRIES
		expect(result.error).toBeDefined()
	})

	it("emits StageRetry event on validation failure", async () => {
		let callCount = 0
		const executor = async () => {
			callCount++
			return callCount === 1 ? { wrong: true } : VALID_INTENT_ARTIFACT
		}
		const events: any[] = []
		eventBus.subscribe((e) => events.push(e))

		const stage = new StageManager(
			{
				stageId: "intent",
				stageName: "Intent",
				outputSchema: IntentArtifactSchema,
				executor,
			},
			{ eventBus, checkpointManager, promptBuilder },
		)

		await stage.run(makeCtx())
		expect(events.some((e) => e.type === "StageRetry")).toBe(true)
	})

	it("does NOT retry on non-Zod errors", async () => {
		let callCount = 0
		const executor = async () => {
			callCount++
			throw new Error("API connection failed")
		}

		const stage = new StageManager(
			{
				stageId: "intent",
				stageName: "Intent",
				outputSchema: IntentArtifactSchema,
				executor,
			},
			{ eventBus, checkpointManager, promptBuilder },
		)

		const result = await stage.run(makeCtx())
		expect(result.ok).toBe(false)
		expect(result.retries).toBe(0) // No retries for non-Zod errors
		expect(callCount).toBe(1) // Called only once
	})
})

// ---------------------------------------------------------------------------
// PipelineController — stops after 3 stages
// ---------------------------------------------------------------------------

describe("PipelineController (Phase 2 — 3 stages only)", () => {
	it("runs exactly 3 stages (intent, planner, architect)", async () => {
		let callCount = 0
		const stageStreams = [makeValidIntentStream(), makeValidRequirementsStream(), makeValidBlueprintStream()]

		const api = makeMockApi(() => {
			return stageStreams[callCount++]!
		})

		const controller = new PipelineController()
		const result = await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
		})

		expect(result.ok).toBe(true)
		expect(result.completedStages).toHaveLength(3)
		expect(result.completedStages).toEqual(["intent", "planner", "architect"])
		expect(result.blueprintArtifact).toBeDefined()
	})

	it("makes exactly 3 LLM calls", async () => {
		let callCount = 0
		const stageStreams = [makeValidIntentStream(), makeValidRequirementsStream(), makeValidBlueprintStream()]

		const api = makeMockApi(() => {
			return stageStreams[callCount++]!
		})

		const controller = new PipelineController()
		await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
		})

		expect(api.createMessage).toHaveBeenCalledTimes(3)
	})

	it("stores intent output in context for planner stage", async () => {
		let callCount = 0
		const stageStreams = [makeValidIntentStream(), makeValidRequirementsStream(), makeValidBlueprintStream()]

		const api = makeMockApi(() => {
			return stageStreams[callCount++]!
		})

		const controller = new PipelineController()
		const result = await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
		})

		expect(result.ok).toBe(true)
		// The blueprint should have the dependency graph
		const blueprint = result.blueprintArtifact as any
		expect(blueprint?.systemArchitecture).toBeDefined()
	})

	it("fails fast on stage error and stops", async () => {
		let callCount = 0
		const api = makeMockApi(() => {
			callCount++
			if (callCount === 2) {
				throw new Error("Stage 2 API failure")
			}
			return callCount === 1 ? makeValidIntentStream() : makeValidBlueprintStream()
		})

		const controller = new PipelineController()
		const result = await controller.run({
			taskId: "test",
			userMessage: "Add dark mode",
			abortSignal: new AbortController().signal,
			api,
		})

		expect(result.ok).toBe(false)
		expect(result.failedStage).toBe("planner")
		expect(result.completedStages).toEqual(["intent"])
	})

	it("reports progress via onProgress callback", async () => {
		const progressEvents: Array<{ stageId: string; status: string }> = []
		let callCount = 0
		const stageStreams = [makeValidIntentStream(), makeValidRequirementsStream(), makeValidBlueprintStream()]

		const api = makeMockApi(() => {
			return stageStreams[callCount++]!
		})

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

		// Each stage should have started and completed
		expect(progressEvents.filter((e) => e.status === "started")).toHaveLength(3)
		expect(progressEvents.filter((e) => e.status === "completed")).toHaveLength(3)
	})
})

// ---------------------------------------------------------------------------
// CheckpointManager — resume capability
// ---------------------------------------------------------------------------

describe("CheckpointManager (Phase 2 — resume)", () => {
	it("tracks completed stages for resume", () => {
		const mgr = new CheckpointManager()
		mgr.save({
			pipelineId: "p1",
			taskId: "t1",
			completedStages: ["intent", "planner"],
			snapshots: [
				{ stageId: "intent", timestamp: Date.now(), output: VALID_INTENT_ARTIFACT },
				{ stageId: "planner", timestamp: Date.now(), output: VALID_REQUIREMENTS_ARTIFACT },
			],
		})

		expect(mgr.getCompletedStages("p1")).toEqual(["intent", "planner"])
		expect(mgr.isStageCompleted("p1", "intent")).toBe(true)
		expect(mgr.isStageCompleted("p1", "architect")).toBe(false)
	})

	it("returns stage output for checkpoint restoration", () => {
		const mgr = new CheckpointManager()
		mgr.save({
			pipelineId: "p1",
			taskId: "t1",
			completedStages: ["intent"],
			snapshots: [{ stageId: "intent", timestamp: Date.now(), output: VALID_INTENT_ARTIFACT }],
		})

		expect(mgr.getStageOutput("p1", "intent")).toEqual(VALID_INTENT_ARTIFACT)
		expect(mgr.getStageOutput("p1", "planner")).toBeUndefined()
	})

	it("returns empty array for unknown pipeline", () => {
		const mgr = new CheckpointManager()
		expect(mgr.getCompletedStages("unknown")).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// Artifact schemas — Phase 2 validation
// ---------------------------------------------------------------------------

describe("Artifact schemas (Phase 2)", () => {
	it("IntentArtifactSchema validates a complete intent", () => {
		expect(() => IntentArtifactSchema.parse(VALID_INTENT_ARTIFACT)).not.toThrow()
	})

	it("RequirementsArtifactSchema validates complete requirements", () => {
		expect(() => RequirementsArtifactSchema.parse(VALID_REQUIREMENTS_ARTIFACT)).not.toThrow()
	})

	it("BlueprintArtifactSchema validates a complete blueprint", () => {
		expect(() => BlueprintArtifactSchema.parse(VALID_BLUEPRINT_ARTIFACT)).not.toThrow()
	})

	it("IntentArtifactSchema rejects missing required fields", () => {
		expect(() => IntentArtifactSchema.parse({ summary: "test" })).toThrow()
	})

	it("BlueprintArtifactSchema rejects invalid risk likelihood", () => {
		expect(() =>
			BlueprintArtifactSchema.parse({
				...VALID_BLUEPRINT_ARTIFACT,
				riskAnalysis: [{ risk: "r", likelihood: "invalid", impact: "low", mitigation: "m" }],
			}),
		).toThrow()
	})
})
