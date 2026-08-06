import { describe, it, expect, vi, beforeEach } from "vitest"
import { SpawnWorkerTool } from "../SpawnWorkerTool"
import type { ToolCallbacks } from "../BaseTool"

vi.mock("vscode", () => ({}))
vi.mock("../orchestration/OrchestrationRuntime", () => ({
	getOrchestrationRuntime: () => ({
		syncWorkerPoolFromProvider: vi.fn(),
		spawnWorker: vi.fn().mockResolvedValue({
			workerId: "w1",
			name: "test-worker",
			role: "worker",
			state: "running",
			mode: "code",
			apiConfigName: "default",
			fallbackChain: [],
		}),
	}),
}))

describe("SpawnWorkerTool", () => {
	let tool: SpawnWorkerTool
	let mockTask: any
	let callbacks: ToolCallbacks

	beforeEach(() => {
		tool = new SpawnWorkerTool()
		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			say: vi.fn(),
			isBackgroundWorker: false,
			providerRef: { deref: () => ({ postStateToWebview: vi.fn().mockResolvedValue(undefined) }) },
			taskId: "test-task",
		}
		callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
	})

	it("should reject missing name parameter", async () => {
		await tool.execute({ name: "", message: "hello" } as any, mockTask, callbacks)
		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("spawn_worker")
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("spawn_worker", "name")
		expect(callbacks.pushToolResult).toHaveBeenCalledWith("Missing parameter error")
	})

	it("should reject missing message parameter", async () => {
		await tool.execute({ name: "worker-1", message: "" } as any, mockTask, callbacks)
		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("spawn_worker")
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("spawn_worker", "message")
		expect(callbacks.pushToolResult).toHaveBeenCalledWith("Missing parameter error")
	})

	it("should reject null message parameter", async () => {
		await tool.execute({ name: "worker-1", message: null } as any, mockTask, callbacks)
		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("spawn_worker", "message")
	})

	it("should reject undefined message parameter", async () => {
		await tool.execute({ name: "worker-1" } as any, mockTask, callbacks)
		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("spawn_worker", "message")
	})

	it("should reject whitespace-only message", async () => {
		await tool.execute({ name: "worker-1", message: "   " } as any, mockTask, callbacks)
		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("spawn_worker", "message")
	})

	it("should reject when background worker tries to spawn", async () => {
		mockTask.isBackgroundWorker = true
		await tool.execute({ name: "w1", message: "hello" } as any, mockTask, callbacks)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Background workers cannot spawn nested workers"),
		)
	})

	it("should succeed with valid name and message", async () => {
		const mockProvider = {
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			getOrchestrationRuntime: () => ({
				syncWorkerPoolFromProvider: vi.fn(),
				spawnWorker: vi.fn().mockResolvedValue({
					workerId: "w1",
					name: "worker-1",
					role: "worker",
					state: "running",
					mode: "code",
					apiConfigName: "default",
					fallbackChain: [],
				}),
			}),
		}
		mockTask.providerRef = { deref: () => mockProvider }
		await tool.execute(
			{
				name: "worker-1",
				message: "do something useful",
				mode: null,
				api_config_name: null,
				fallback_api_config_names: null,
				role: null,
				review_target_id: null,
			} as any,
			mockTask,
			callbacks,
		)
		expect(mockTask.consecutiveMistakeCount).toBe(0)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining('"ok": true'))
	})

	it("should reset consecutiveMistakeCount on success", async () => {
		const mockProvider = {
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			getOrchestrationRuntime: () => ({
				syncWorkerPoolFromProvider: vi.fn(),
				spawnWorker: vi.fn().mockResolvedValue({
					workerId: "w1",
					name: "worker-1",
					role: "worker",
					state: "running",
					mode: "code",
					apiConfigName: "default",
					fallbackChain: [],
				}),
			}),
		}
		mockTask.providerRef = { deref: () => mockProvider }
		mockTask.consecutiveMistakeCount = 3
		await tool.execute(
			{
				name: "worker-1",
				message: "do something useful",
				mode: null,
				api_config_name: null,
				fallback_api_config_names: null,
				role: null,
				review_target_id: null,
			} as any,
			mockTask,
			callbacks,
		)
		expect(mockTask.consecutiveMistakeCount).toBe(0)
	})

	it("should use findMissingRequiredParam helper to detect missing fields", () => {
		// Verify BaseTool.findMissingRequiredParam works correctly
		const result = (tool as any).findMissingRequiredParam({}, { name: "w1", message: "" })
		expect(result).toBe("message")
	})

	it("should return null when all required params are present", () => {
		const result = (tool as any).findMissingRequiredParam({}, { name: "w1", message: "hello" })
		expect(result).toBeNull()
	})
})
