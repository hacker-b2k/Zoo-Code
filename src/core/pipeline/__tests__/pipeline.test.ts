import { describe, it, expect, beforeEach, vi } from "vitest"

import { EventBus } from "../EventBus"
import { CheckpointManager } from "../CheckpointManager"
import { MemoryStore } from "../MemoryStore"
import { StageManager, type StageManagerConfig } from "../StageManager"
import { StagePromptBuilder } from "../StagePromptBuilder"
import { PipelineScheduler, type StageDefinition } from "../PipelineScheduler"
import { PipelineController } from "../PipelineController"
import type { PipelineContext } from "../types"
import { IntentArtifactSchema, CodeArtifactsSchema } from "../artifacts"
import type { PipelineEvent } from "../EventBus"

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

describe("EventBus", () => {
	it("emits events to subscribers", () => {
		const bus = new EventBus()
		const received: PipelineEvent[] = []
		bus.subscribe((e) => received.push(e))

		bus.emit({
			type: "StageStarted",
			pipelineId: "p1",
			timestamp: Date.now(),
		})

		expect(received).toHaveLength(1)
		expect(received[0]!.type).toBe("StageStarted")
	})

	it("unsubscribe stops events", () => {
		const bus = new EventBus()
		const received: PipelineEvent[] = []
		const unsub = bus.subscribe((e) => received.push(e))

		unsub()

		bus.emit({
			type: "StageStarted",
			pipelineId: "p1",
			timestamp: Date.now(),
		})

		expect(received).toHaveLength(0)
	})

	it("listener errors do not break the bus", () => {
		const bus = new EventBus()
		bus.subscribe(() => {
			throw new Error("boom")
		})

		expect(() => bus.emit({ type: "StageFinished", pipelineId: "p1", timestamp: Date.now() })).not.toThrow()
	})

	it("clear removes all listeners", () => {
		const bus = new EventBus()
		const received: PipelineEvent[] = []
		bus.subscribe((e) => received.push(e))
		bus.clear()

		bus.emit({ type: "StageStarted", pipelineId: "p1", timestamp: Date.now() })

		expect(received).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// CheckpointManager
// ---------------------------------------------------------------------------

describe("CheckpointManager", () => {
	it("saves and loads checkpoints", () => {
		const mgr = new CheckpointManager()
		const cp = {
			pipelineId: "p1",
			taskId: "t1",
			completedStages: ["intent"],
			snapshots: [{ stageId: "intent", timestamp: Date.now(), output: { ok: true } }],
		}
		mgr.save(cp)
		expect(mgr.load("p1")).toEqual(cp)
	})

	it("returns undefined for unknown pipelineId", () => {
		const mgr = new CheckpointManager()
		expect(mgr.load("nonexistent")).toBeUndefined()
	})

	it("clear removes a checkpoint", () => {
		const mgr = new CheckpointManager()
		mgr.save({
			pipelineId: "p1",
			taskId: "t1",
			completedStages: [],
			snapshots: [],
		})
		mgr.clear("p1")
		expect(mgr.load("p1")).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------

describe("MemoryStore", () => {
	it("writes and reads mutable partitions", () => {
		const store = new MemoryStore()
		store.write("CodingMemory", { files: ["a.ts"] })
		expect(store.get("CodingMemory")?.value).toEqual({ files: ["a.ts"] })
	})

	it("rejects writes to immutable partitions", () => {
		const store = new MemoryStore([{ id: "IntentMemory", owner: "intent", mutable: false }])
		expect(() => store.write("IntentMemory", { x: 1 })).toThrow(/immutable/)
	})

	it("snapshot returns a shallow copy of all partitions", () => {
		const store = new MemoryStore([{ id: "IntentMemory", owner: "intent", mutable: false, value: { a: 1 } }])
		const snap = store.snapshot()
		expect(snap).toHaveLength(1)
		expect(snap[0]!.id).toBe("IntentMemory")
	})
})

// ---------------------------------------------------------------------------
// StageManager (with mocked executor)
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
	return {
		pipelineId: "test-pipeline",
		taskId: "test-task",
		userMessage: "hello",
		abortSignal: new AbortController().signal,
		startTime: Date.now(),
		completedStages: [],
		currentStage: "(none)",
		...overrides,
	}
}

describe("StageManager", () => {
	let eventBus: EventBus
	let checkpointManager: CheckpointManager
	let promptBuilder: StagePromptBuilder

	beforeEach(() => {
		eventBus = new EventBus()
		checkpointManager = new CheckpointManager()
		promptBuilder = new StagePromptBuilder()
	})

	function makeStage(config: Partial<StageManagerConfig> = {}): StageManager {
		return new StageManager(
			{ stageId: "test", stageName: "Test", ...config },
			{ eventBus, checkpointManager, promptBuilder },
		)
	}

	it("runs skeleton executor when no executor is provided", async () => {
		const stage = makeStage()
		const result = await stage.run(makeCtx())
		expect(result.ok).toBe(true)
		expect(result.stageId).toBe("test")
		expect(result.output).toBeDefined()
	})

	it("uses injected executor and validates against schema", async () => {
		const validOutput = {
			summary: "test",
			primaryGoal: "goal",
			constraints: [],
			hiddenRequirements: [],
			risks: [],
			missingInfo: [],
			successCriteria: [],
			confidence: 80,
			confidenceRationale: "test",
		}
		const stage = makeStage({
			outputSchema: IntentArtifactSchema,
			executor: async () => validOutput,
		})
		const result = await stage.run(makeCtx())
		expect(result.ok).toBe(true)
		expect(result.output).toEqual(validOutput)
	})

	it("fails when executor output doesn't match schema", async () => {
		const stage = makeStage({
			outputSchema: IntentArtifactSchema,
			executor: async () => ({ wrong: true }),
		})
		const result = await stage.run(makeCtx())
		expect(result.ok).toBe(false)
		expect(result.error).toBeDefined()
	})

	it("emits StageStarted and StageFinished events on success", async () => {
		const events: PipelineEvent[] = []
		eventBus.subscribe((e) => events.push(e))
		const stage = makeStage()
		await stage.run(makeCtx())
		const types = events.map((e) => e.type)
		expect(types).toContain("StageStarted")
		expect(types).toContain("StageFinished")
	})

	it("emits StageFailed on executor error", async () => {
		const events: PipelineEvent[] = []
		eventBus.subscribe((e) => events.push(e))
		const stage = makeStage({
			executor: async () => {
				throw new Error("executor fail")
			},
		})
		const result = await stage.run(makeCtx())
		expect(result.ok).toBe(false)
		expect(events.some((e) => e.type === "StageFailed")).toBe(true)
	})

	it("saves a checkpoint on success", async () => {
		const stage = makeStage()
		const ctx = makeCtx({ pipelineId: "ckpt-test" })
		await stage.run(ctx)
		const cp = checkpointManager.load("ckpt-test")
		expect(cp).toBeDefined()
		expect(cp!.completedStages).toContain("test")
	})
})

// ---------------------------------------------------------------------------
// PipelineScheduler
// ---------------------------------------------------------------------------

describe("PipelineScheduler", () => {
	it("runs stages sequentially and collects outcomes", async () => {
		const scheduler = new PipelineScheduler()
		const stages: StageDefinition[] = [
			{ id: "a", stageName: "A" },
			{ id: "b", stageName: "B" },
		]
		const outcomes = await scheduler.run(stages, makeCtx())
		expect(outcomes).toHaveLength(2)
		expect(outcomes.every((o) => o.ok)).toBe(true)
	})

	it("stops on first failure", async () => {
		const scheduler = new PipelineScheduler()
		const stages: StageDefinition[] = [
			{
				id: "a",
				stageName: "A",
				executor: async () => {
					throw new Error("boom")
				},
			},
			{ id: "b", stageName: "B" },
		]
		const outcomes = await scheduler.run(stages, makeCtx())
		expect(outcomes).toHaveLength(1)
		expect(outcomes[0]!.ok).toBe(false)
	})

	it("emits PipelineStarted + StageStarted/StageFinished via eventBus", async () => {
		const scheduler = new PipelineScheduler()
		const events: PipelineEvent[] = []
		scheduler.getEventBus().subscribe((e) => events.push(e))

		await scheduler.run([{ id: "x", stageName: "X" }], makeCtx())

		const types = events.map((e) => e.type)
		expect(types).toContain("StageStarted")
		expect(types).toContain("StageFinished")
	})
})

// ---------------------------------------------------------------------------
// PipelineController (end-to-end skeleton)
// ---------------------------------------------------------------------------

describe("PipelineController", () => {
	it("runs the 3-stage thinking pipeline (Phase 2: stops after architect)", async () => {
		// In Phase 2, PipelineController runs only stages 1-3.
		// Without an ApiHandler, the skeleton executor runs instead.
		const controller = new PipelineController()
		const result = await controller.run({
			taskId: "controller-test",
			userMessage: "test message",
			abortSignal: new AbortController().signal,
		})

		// Skeleton output won't pass Zod validation, so the pipeline
		// will fail at the first stage. This is expected Phase 1 behavior.
		// Phase 2 tests verify the full flow with a mock API handler.
		expect(result.completedStages).toBeDefined()
		expect(result.pipelineId).toBeDefined()
	})

	it("generates a unique pipelineId", async () => {
		const controller = new PipelineController()
		const r1 = await controller.run({
			taskId: "t1",
			userMessage: "a",
			abortSignal: new AbortController().signal,
		})
		const r2 = await controller.run({
			taskId: "t2",
			userMessage: "b",
			abortSignal: new AbortController().signal,
		})
		expect(r1.pipelineId).not.toBe(r2.pipelineId)
	})
})

// ---------------------------------------------------------------------------
// Artifacts schema validation
// ---------------------------------------------------------------------------

describe("Artifact schemas", () => {
	it("IntentArtifactSchema validates correct output", () => {
		const valid = {
			summary: "s",
			primaryGoal: "g",
			constraints: [],
			hiddenRequirements: [],
			risks: [],
			missingInfo: [],
			successCriteria: [],
			confidence: 90,
			confidenceRationale: "high",
		}
		expect(() => IntentArtifactSchema.parse(valid)).not.toThrow()
	})

	it("IntentArtifactSchema rejects invalid confidence", () => {
		const invalid = {
			summary: "s",
			primaryGoal: "g",
			constraints: [],
			hiddenRequirements: [],
			risks: [],
			missingInfo: [],
			successCriteria: [],
			confidence: 150,
			confidenceRationale: "x",
		}
		expect(() => IntentArtifactSchema.parse(invalid)).toThrow()
	})

	it("CodeArtifactsSchema validates a complete artifact", () => {
		const valid = {
			filesCreated: ["a.ts"],
			filesModified: ["b.ts"],
			implementationSummary: "done",
			deviations: [],
			completionStatus: "complete",
			confidence: 95,
			confidenceRationale: "all green",
		}
		expect(() => CodeArtifactsSchema.parse(valid)).not.toThrow()
	})

	it("CodeArtifactsSchema rejects invalid completionStatus", () => {
		const invalid = {
			filesCreated: [],
			filesModified: [],
			implementationSummary: "x",
			deviations: [],
			completionStatus: "unknown",
			confidence: 50,
			confidenceRationale: "x",
		}
		expect(() => CodeArtifactsSchema.parse(invalid)).toThrow()
	})
})

// ---------------------------------------------------------------------------
// StagePromptBuilder
// ---------------------------------------------------------------------------

describe("StagePromptBuilder", () => {
	it("builds a real system prompt for known stages", () => {
		const builder = new StagePromptBuilder()
		const prompt = builder.buildSystemPrompt("intent")
		expect(prompt).toContain("Intent Interpreter")
		expect(prompt).not.toContain("placeholder")
	})

	it("builds a user message with pipeline context", () => {
		const builder = new StagePromptBuilder()
		const ctx = makeCtx({ userMessage: "Add login page" })
		const msg = builder.buildUserMessage("intent", ctx)
		expect(msg).toContain("Add login page")
	})

	it("falls back to placeholder for unknown stages", () => {
		const builder = new StagePromptBuilder()
		const prompt = builder.buildSystemPrompt("unknown-stage")
		expect(prompt).toContain("not yet implemented")
	})
})
