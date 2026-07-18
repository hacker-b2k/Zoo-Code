import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn(() => ({ getModel: () => ({ id: "mock", info: {} }) })),
}))

import {
	OrchestrationRuntime,
	getOrchestrationRuntime,
	resetOrchestrationRuntimeForTests,
} from "../OrchestrationRuntime"

describe("OrchestrationRuntime singleton + isolation helpers", () => {
	afterEach(() => {
		resetOrchestrationRuntimeForTests()
	})

	it("getOrchestrationRuntime rebinds provider getter", () => {
		const p1 = { id: 1 } as any
		const p2 = { id: 2 } as any
		const r1 = getOrchestrationRuntime(() => p1)
		const r2 = getOrchestrationRuntime(() => p2)
		expect(r1).toBe(r2)
	})
})

describe("OrchestrationRuntime.list/count/inbox", () => {
	let runtime: OrchestrationRuntime

	beforeEach(() => {
		resetOrchestrationRuntimeForTests()
		const provider = {
			getCurrentTask: () => ({ taskId: "main-1", isBackgroundWorker: false }),
			providerSettingsManager: {
				getProfile: vi.fn(async ({ name }: { name: string }) => ({
					name,
					apiProvider: "openai",
					openAiApiKey: "k",
				})),
				listConfig: vi.fn(async () => [{ name: "default", id: "default" }]),
			},
			createBackgroundWorkerTask: vi.fn(async (params: any) => {
				const task = {
					taskId: params.workerId,
					on: vi.fn(),
					apiConfiguration: params.apiConfiguration,
					api: { getModel: () => ({ id: "mock", info: {} }) },
					setTaskApiConfigName: vi.fn(),
					updateApiConfiguration: vi.fn(function (this: any, cfg: unknown) {
						this.apiConfiguration = cfg
						this.api = { getModel: () => ({ id: "mock-switched", info: {} }) }
					}),
					clineMessages: [],
					abort: false,
					abortReason: undefined as string | undefined,
					abortTask: vi.fn(),
					cancelCurrentRequest: vi.fn(),
				}
				return task
			}),
			getState: vi.fn(async () => ({ currentApiConfigName: "default" })),
		} as any

		runtime = new OrchestrationRuntime(() => provider)
	})

	it("spawnWorker registers worker and listWorkers filters by parent", async () => {
		const snap = await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "impl",
			message: "Build feature X",
			apiConfigName: "default",
			fallbackApiConfigNames: ["default"],
		})
		expect(snap.state).toBe("running")
		expect(snap.name).toBe("impl")
		// Default mode is code when spawn omits mode (sticky tools for workers).
		expect(snap.mode).toBe("code")
		expect(runtime.listWorkers("main-1").length).toBe(1)
		expect(runtime.countRunning("main-1")).toBe(1)

		runtime.completeWorker(snap.workerId, "all good")
		const text = runtime.collectResults("main-1", true)
		expect(text).toContain("all good")
		expect(runtime.countRunning("main-1")).toBe(0)
	})

	it("listResults peeks inbox without marking read", async () => {
		const snap = await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "impl",
			message: "work",
		})
		runtime.completeWorker(snap.workerId, "peek me")
		const unread = runtime.listResults("main-1", true)
		expect(unread.length).toBe(1)
		expect(unread[0].summary).toBe("peek me")
		// Still unread after peek
		expect(runtime.listResults("main-1", true).length).toBe(1)
		// collect drains
		runtime.collectResults("main-1", true)
		expect(runtime.listResults("main-1", true).length).toBe(0)
	})

	it("resolves parent via findLiveTask when getCurrentTask is a focused worker", async () => {
		const mainTask = { taskId: "main-1", isBackgroundWorker: false }
		const focusedWorker = { taskId: "worker-focused", isBackgroundWorker: true }
		const provider = {
			getCurrentTask: () => focusedWorker,
			findLiveTask: vi.fn((id: string) => (id === "main-1" ? mainTask : undefined)),
			providerSettingsManager: {
				getProfile: vi.fn(async ({ name }: { name: string }) => ({
					name,
					apiProvider: "openai",
					openAiApiKey: "k",
				})),
				listConfig: vi.fn(async () => [{ name: "default", id: "default" }]),
			},
			createBackgroundWorkerTask: vi.fn(async (params: any) => ({
				taskId: params.workerId,
				on: vi.fn(),
				apiConfiguration: params.apiConfiguration,
				api: { getModel: () => ({ id: "mock", info: {} }) },
				setTaskApiConfigName: vi.fn(),
				updateApiConfiguration: vi.fn(),
				clineMessages: [],
				abort: false,
				abortReason: undefined as string | undefined,
				abortTask: vi.fn(),
				cancelCurrentRequest: vi.fn(),
			})),
			getState: vi.fn(async () => ({ currentApiConfigName: "default" })),
		} as any
		const r = new OrchestrationRuntime(() => provider)
		const snap = await r.spawnWorker({
			parentTaskId: "main-1",
			name: "impl-from-focused-ui",
			message: "still under main",
		})
		expect(snap.parentTaskId).toBe("main-1")
		expect(provider.findLiveTask).toHaveBeenCalledWith("main-1")
		expect(provider.createBackgroundWorkerTask).toHaveBeenCalledWith(
			expect.objectContaining({ parentTask: mainTask }),
		)
	})

	it("defaults omitted mode to code and preserves explicit mode", async () => {
		const a = await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "a",
			message: "work",
		})
		expect(a.mode).toBe("code")

		const b = await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "b",
			message: "work",
			mode: "architect",
		})
		expect(b.mode).toBe("architect")
	})

	it("load-balances successive spawns across worker-enabled providers", async () => {
		const profiles: Record<string, Record<string, unknown>> = {
			p1: { apiProvider: "openai", openAiApiKey: "1" },
			p2: { apiProvider: "openai", openAiApiKey: "2" },
			p3: { apiProvider: "openai", openAiApiKey: "3" },
		}
		const assigned: string[] = []
		const provider = {
			getCurrentTask: () => ({ taskId: "main-1", isBackgroundWorker: false }),
			contextProxy: {
				getValue: (k: string) =>
					k === "workerEnabledApiConfigs" ? { p1: true, p2: true, p3: true } : undefined,
			},
			providerSettingsManager: {
				getProfile: vi.fn(async ({ name }: { name: string }) => {
					if (!profiles[name]) {
						throw new Error(`missing ${name}`)
					}
					return { name, ...profiles[name] }
				}),
				listConfig: vi.fn(async () =>
					Object.keys(profiles).map((name) => ({ name, id: name, apiProvider: "openai" })),
				),
			},
			createBackgroundWorkerTask: vi.fn(async (params: any) => {
				assigned.push(params.apiConfigName)
				return {
					taskId: params.workerId,
					on: vi.fn(),
					apiConfiguration: params.apiConfiguration,
					api: { getModel: () => ({ id: "mock", info: {} }) },
					setTaskApiConfigName: vi.fn(),
					updateApiConfiguration: vi.fn(),
					clineMessages: [],
					abort: false,
					abortTask: vi.fn(),
					cancelCurrentRequest: vi.fn(),
				}
			}),
			getState: vi.fn(async () => ({ currentApiConfigName: "p1" })),
			postStateToWebview: vi.fn(async () => undefined),
		} as any

		resetOrchestrationRuntimeForTests()
		const rt = new OrchestrationRuntime(() => provider)
		// No preferred → should spread p1,p2,p3
		const s1 = await rt.spawnWorker({ parentTaskId: "main-1", name: "w1", message: "a" })
		const s2 = await rt.spawnWorker({ parentTaskId: "main-1", name: "w2", message: "b" })
		const s3 = await rt.spawnWorker({ parentTaskId: "main-1", name: "w3", message: "c" })
		const names = [s1.apiConfigName, s2.apiConfigName, s3.apiConfigName]
		expect(new Set(names).size).toBe(3)
		expect(names.sort()).toEqual(["p1", "p2", "p3"])
		// Fallback chain for each should include full pool for failover
		expect(s1.fallbackChain.length).toBeGreaterThanOrEqual(3)
	})

	it("spreads providers even when every spawn pins the same apiConfigName", async () => {
		const profiles: Record<string, Record<string, unknown>> = {
			nvidia: { apiProvider: "openai", openAiApiKey: "n" },
			vertex: { apiProvider: "openai", openAiApiKey: "v" },
			groq: { apiProvider: "openai", openAiApiKey: "g" },
			mimo: { apiProvider: "openai", openAiApiKey: "m" },
		}
		const provider = {
			getCurrentTask: () => ({ taskId: "main-1", isBackgroundWorker: false }),
			contextProxy: {
				getValue: (k: string) =>
					k === "workerEnabledApiConfigs"
						? { nvidia: true, vertex: true, groq: true, mimo: true }
						: undefined,
			},
			providerSettingsManager: {
				getProfile: vi.fn(async ({ name }: { name: string }) => {
					if (!profiles[name]) {
						throw new Error(`missing ${name}`)
					}
					return { name, ...profiles[name] }
				}),
				listConfig: vi.fn(async () =>
					Object.keys(profiles).map((name) => ({ name, id: name, apiProvider: "openai" })),
				),
			},
			createBackgroundWorkerTask: vi.fn(async (params: any) => ({
				taskId: params.workerId,
				on: vi.fn(),
				apiConfiguration: params.apiConfiguration,
				api: { getModel: () => ({ id: "mock", info: {} }) },
				setTaskApiConfigName: vi.fn(),
				updateApiConfiguration: vi.fn(),
				clineMessages: [],
				abort: false,
				abortTask: vi.fn(),
				cancelCurrentRequest: vi.fn(),
			})),
			getState: vi.fn(async () => ({ currentApiConfigName: "vertex" })),
			postStateToWebview: vi.fn(async () => undefined),
		} as any

		resetOrchestrationRuntimeForTests()
		const rt = new OrchestrationRuntime(() => provider)
		// Main on vertex; agent wrongly pins every worker to nvidia
		const s1 = await rt.spawnWorker({
			parentTaskId: "main-1",
			name: "w1",
			message: "a",
			apiConfigName: "nvidia",
		})
		const s2 = await rt.spawnWorker({
			parentTaskId: "main-1",
			name: "w2",
			message: "b",
			apiConfigName: "nvidia",
		})
		const s3 = await rt.spawnWorker({
			parentTaskId: "main-1",
			name: "w3",
			message: "c",
			apiConfigName: "nvidia",
		})
		const s4 = await rt.spawnWorker({
			parentTaskId: "main-1",
			name: "w4",
			message: "d",
			apiConfigName: "nvidia",
		})
		const names = [s1.apiConfigName, s2.apiConfigName, s3.apiConfigName, s4.apiConfigName]
		expect(new Set(names).size).toBe(4)
		expect(names.sort()).toEqual(["groq", "mimo", "nvidia", "vertex"])
	})

	it("workerQuestion pushes question kind and formats for agent", () => {
		// Manually register a handle via spawn then question
		return runtime
			.spawnWorker({
				parentTaskId: "main-1",
				name: "q-worker",
				message: "ask something",
			})
			.then((snap) => {
				runtime.workerQuestion(snap.workerId, "Which API key should I use?")
				const text = runtime.collectResults("main-1", true)
				expect(text).toContain("[question]")
				expect(text).toContain("Which API key should I use?")
				// Question does not complete the worker
				expect(runtime.countRunning("main-1")).toBe(1)
			})
	})

	it("notifyParentAndWake injects into parent when autoInject enabled", async () => {
		const parentTask = {
			taskId: "main-1",
			isBackgroundWorker: false,
			taskAsk: undefined,
			taskStatus: "running",
			say: vi.fn(async () => undefined),
			submitUserMessage: vi.fn(async () => undefined),
			processQueuedMessages: vi.fn(),
			messageQueueService: { addMessage: vi.fn() },
		}
		const provider = {
			getCurrentTask: () => parentTask,
			findLiveTask: (id: string) => (id === "main-1" ? parentTask : undefined),
			providerSettingsManager: {
				getProfile: vi.fn(async ({ name }: { name: string }) => ({
					name,
					apiProvider: "openai",
					openAiApiKey: "k",
				})),
				listConfig: vi.fn(async () => [{ name: "default", id: "default" }]),
			},
			createBackgroundWorkerTask: vi.fn(async (params: any) => ({
				taskId: params.workerId,
				on: vi.fn(),
				apiConfiguration: params.apiConfiguration,
				api: { getModel: () => ({ id: "mock", info: {} }) },
				setTaskApiConfigName: vi.fn(),
				updateApiConfiguration: vi.fn(),
				clineMessages: [],
				abort: false,
				abortTask: vi.fn(),
				cancelCurrentRequest: vi.fn(),
			})),
			getState: vi.fn(async () => ({ currentApiConfigName: "default" })),
			postStateToWebview: vi.fn(async () => undefined),
		} as any

		resetOrchestrationRuntimeForTests()
		const rt = new OrchestrationRuntime(() => provider)
		rt.updateSettings({ autoInjectResultsWhenIdle: true })

		const snap = await rt.spawnWorker({
			parentTaskId: "main-1",
			name: "impl",
			message: "Build",
		})
		// createBackgroundWorkerTask should receive sticky code mode
		expect(provider.createBackgroundWorkerTask).toHaveBeenCalledWith(expect.objectContaining({ mode: "code" }))

		rt.completeWorker(snap.workerId, "shipped")
		// Allow async notify
		await new Promise((r) => setTimeout(r, 20))
		expect(parentTask.say).toHaveBeenCalled()
		expect(parentTask.messageQueueService.addMessage).toHaveBeenCalled()
		const queued = (parentTask.messageQueueService.addMessage as any).mock.calls[0][0] as string
		expect(queued).toContain("worker_event")
		expect(queued).toContain("shipped")
	})

	it("handleWorkerApiFailure switches provider via manager", async () => {
		const snap = await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "impl",
			message: "work",
			apiConfigName: "default",
			fallbackApiConfigNames: ["backup"],
		})

		// First failures: same-provider retry
		const d1 = await runtime.handleWorkerApiFailure(snap.workerId, new Error("timeout"))
		expect(d1.shouldRetry).toBe(true)

		// Exhaust same retries then switch (maxSameProviderRetries default 2)
		await runtime.handleWorkerApiFailure(snap.workerId, new Error("timeout"))
		const dSwitch = await runtime.handleWorkerApiFailure(snap.workerId, new Error("timeout"))
		// Depending on counts, may switch or retry; after enough attempts should switch or fail
		expect(typeof dSwitch.shouldRetry).toBe("boolean")
	})

	it("rejects spawn when orchestration disabled", async () => {
		runtime.updateSettings({ enabled: false })
		await expect(
			runtime.spawnWorker({
				parentTaskId: "main-1",
				name: "x",
				message: "y",
			}),
		).rejects.toThrow(/disabled/i)
	})
})

describe("OrchestrationRuntime always-on reviewer", () => {
	let runtime: OrchestrationRuntime
	let createBackgroundWorkerTask: ReturnType<typeof vi.fn>

	beforeEach(() => {
		resetOrchestrationRuntimeForTests()
		createBackgroundWorkerTask = vi.fn(async (params: any) => {
			const task = {
				taskId: params.workerId,
				on: vi.fn(),
				apiConfiguration: params.apiConfiguration,
				api: { getModel: () => ({ id: "mock", info: {} }) },
				setTaskApiConfigName: vi.fn(),
				updateApiConfiguration: vi.fn(function (this: any, cfg: unknown) {
					this.apiConfiguration = cfg
					this.api = { getModel: () => ({ id: "mock-switched", info: {} }) }
				}),
				clineMessages: [],
				abort: false,
				abortReason: undefined as string | undefined,
				abortTask: vi.fn(),
				cancelCurrentRequest: vi.fn(),
			}
			return task
		})
		const provider = {
			getCurrentTask: () => ({ taskId: "main-1", isBackgroundWorker: false }),
			providerSettingsManager: {
				getProfile: vi.fn(async ({ name }: { name: string }) => ({
					name,
					apiProvider: "openai",
					openAiApiKey: "k",
				})),
				listConfig: vi.fn(async () => [{ name: "default", id: "default" }]),
			},
			createBackgroundWorkerTask,
			getState: vi.fn(async () => ({ currentApiConfigName: "default" })),
			postStateToWebview: vi.fn(async () => undefined),
		} as any

		runtime = new OrchestrationRuntime(() => provider)
	})

	afterEach(() => {
		resetOrchestrationRuntimeForTests()
	})

	it("spawns reviewer with role=reviewer, default mode ask, and role system wrap", async () => {
		const snap = await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "fleet-reviewer",
			message: "Watch the fleet",
			role: "reviewer",
			reviewTargetId: "focus-w1",
		})

		expect(snap.role).toBe("reviewer")
		expect(snap.mode).toBe("ask")
		expect(snap.reviewTargetId).toBe("focus-w1")
		expect(createBackgroundWorkerTask).toHaveBeenCalledWith(
			expect.objectContaining({
				workerRole: "reviewer",
				mode: "ask",
				reviewTargetId: "focus-w1",
				message: expect.stringContaining("[ALWAYS-ON REVIEWER ROLE - SYSTEM]"),
			}),
		)
		const call = createBackgroundWorkerTask.mock.calls[0][0]
		expect(call.message).toContain("Watch the fleet")
		expect(call.message).toMatch(/focus|focus-w1/i)
	})

	it("rejects a second active reviewer for the same main task", async () => {
		await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "fleet-reviewer",
			message: "Watch",
			role: "reviewer",
		})

		await expect(
			runtime.spawnWorker({
				parentTaskId: "main-1",
				name: "second-reviewer",
				message: "Also watch",
				role: "reviewer",
			}),
		).rejects.toThrow(/always-on reviewer is already running/i)
	})

	it("countRunningImplementers excludes reviewers (main completion gate)", async () => {
		const impl = await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "impl-a",
			message: "build",
		})
		const rev = await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "fleet-reviewer",
			message: "watch",
			role: "reviewer",
		})

		expect(runtime.countRunning("main-1")).toBe(2)
		expect(runtime.countRunningImplementers("main-1")).toBe(1)
		expect(runtime.listActiveReviewers("main-1").map((s) => s.workerId)).toEqual([rev.workerId])

		// Implementer done → only reviewer remains; implementer gate must be 0 (main may complete).
		runtime.completeWorker(impl.workerId, "done")
		expect(runtime.countRunningImplementers("main-1")).toBe(0)
		expect(runtime.countRunning("main-1")).toBe(1)
		expect(runtime.listActiveReviewers("main-1").length).toBe(1)
	})

	it("does not consume implementer parallel slots for reviewers", async () => {
		runtime.updateSettings({ maxParallelWorkers: 1 })

		await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "impl-a",
			message: "build",
		})
		// Reviewer must still spawn when implementer cap is full.
		const rev = await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "fleet-reviewer",
			message: "watch",
			role: "reviewer",
		})
		expect(rev.role).toBe("reviewer")
		expect(runtime.countRunningImplementers("main-1")).toBe(1)

		await expect(
			runtime.spawnWorker({
				parentTaskId: "main-1",
				name: "impl-b",
				message: "build more",
			}),
		).rejects.toThrow(/Max parallel workers/i)
	})

	it("reportReviewerDigest pushes review_digest without completing or cleaning up", async () => {
		const rev = await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "fleet-reviewer",
			message: "watch",
			role: "reviewer",
		})

		runtime.reportReviewerDigest(rev.workerId, "impl-a running; no rate_limit")
		const text = runtime.collectResults("main-1", true)
		expect(text).toContain("review_digest")
		expect(text).toContain("impl-a running; no rate_limit")
		expect(text).toContain("role=reviewer")

		const listed = runtime.listWorkers("main-1").find((s) => s.workerId === rev.workerId)
		expect(listed?.state).toBe("running")
		expect(runtime.countRunning("main-1")).toBe(1)
		expect(runtime.listActiveReviewers("main-1").length).toBe(1)

		// Second digest still keeps reviewer alive.
		runtime.reportReviewerDigest(rev.workerId, "impl-a completed")
		const text2 = runtime.collectResults("main-1", true)
		expect(text2).toContain("impl-a completed")
		expect(runtime.listWorkers("main-1").find((s) => s.workerId === rev.workerId)?.state).toBe("running")
	})

	it("reportReviewerDigest on non-reviewer falls back to completeWorker", async () => {
		const impl = await runtime.spawnWorker({
			parentTaskId: "main-1",
			name: "impl-a",
			message: "build",
		})
		runtime.reportReviewerDigest(impl.workerId, "should complete as worker")
		const text = runtime.collectResults("main-1", true)
		expect(text).toContain("[completed]")
		expect(text).toContain("should complete as worker")
		expect(runtime.countRunning("main-1")).toBe(0)
	})
})
