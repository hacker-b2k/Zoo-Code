import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Task } from "../../task/Task"
import type { ToolCallbacks } from "../BaseTool"
import type { ToolUse } from "../../../shared/tools"
import { OpenTabsTool } from "../OpenTabsTool"
import * as browserLaunch from "../helpers/browserLaunch"

vi.mock("../helpers/browserLaunch", async () => {
	const actual = await vi.importActual<typeof import("../helpers/browserLaunch")>("../helpers/browserLaunch")
	return {
		...actual,
		openTabs: vi.fn(),
	}
})

describe("OpenTabsTool", () => {
	let tool: OpenTabsTool
	let mockTask: Task

	beforeEach(() => {
		vi.clearAllMocks()
		tool = new OpenTabsTool()
		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			askId: "test-task",
			ask: vi.fn().mockResolvedValue(undefined),
			askState: {},
			askAsk: undefined,
			askAskResponse: undefined,
			askAskState: undefined,
			askAskApproval: undefined,
			askSay: undefined,
			askToolResult: undefined,
			askToolUse: undefined,
			askReasoning: undefined,
			askApiReq: undefined,
			askMcp: undefined,
			askText: undefined,
			askError: undefined,
			askWarning: undefined,
			askInfo: undefined,
			askDone: undefined,
			askCancelled: undefined,
			askStarted: undefined,
			askUpdated: undefined,
			askCompleted: undefined,
			askFailed: undefined,
			askProgress: undefined,
			askMetadata: undefined,
			askContext: undefined,
			askStateUpdated: undefined,
			askPersisted: undefined,
			providerRef: { deref: vi.fn().mockReturnValue(undefined) },
			askDirPath: "",
			cwd: "c:/test/workspace",
			askNumber: 1,
			abort: false,
			askMessages: [],
			userMessageContent: [],
			assistantMessageContent: [],
			askHistory: [],
			messageHistory: [],
			askStack: [],
			lastMessageTs: Date.now(),
			askSummary: "",
			askTitle: "",
			askDescription: "",
			toolUsage: {},
			askMode: "code",
			askModeConfig: {},
			consecutiveNoToolUseCount: 0,
			consecutiveNoAssistantMessagesCount: 0,
			askContextWindow: 0,
			askContextUsed: 0,
			askTokenUsage: 0,
			askCost: 0,
			askDuration: 0,
			askStatus: "running",
			askPriority: 0,
			askTags: [],
			askNotes: "",
			askOutcome: "",
			askArtifacts: [],
			taskLinks: [],
			askFiles: [],
			taskCommands: [],
			taskTools: [],
			taskErrors: [],
			taskWarnings: [],
			askInfoMessages: [],
			askDebugMessages: [],
			askTraceMessages: [],
			askMetrics: {},
			askConfig: {},
			askEnvironment: {},
			askDependencies: [],
			taskOutputs: [],
			askInputs: [],
			askResults: [],
			askLogs: [],
			askEvents: [],
			askTimeline: [],
			askChildren: [],
			askParent: undefined,
			askRoot: undefined,
			taskSession: undefined,
			askWorkspace: undefined,
			askProject: undefined,
			askUser: undefined,
			askSystem: undefined,
			askModel: undefined,
			askProvider: undefined,
			askSettings: undefined,
			askSecrets: undefined,
			askCache: undefined,
			askIndex: undefined,
			askMcpHub: undefined,
			askDiffStrategy: undefined,
			taskSkillsManager: undefined,
			askOutputChannel: undefined,
			askContextProxy: undefined,
			askCodeIndexManager: undefined,
			askBrowser: undefined,
			askTerminal: undefined,
			askEditor: undefined,
			askWebview: undefined,
			askExtension: undefined,
			askTelemetry: undefined,
			askCloud: undefined,
			askAuth: undefined,
			askStorage: undefined,
			askFs: undefined,
			askPath: undefined,
			askEnv: undefined,
			askNetwork: undefined,
			askOs: undefined,
			askPlatform: undefined,
			askVersion: undefined,
			askBuild: undefined,
			askRelease: undefined,
			askModeSlug: "code",
			askAskFn: undefined,
			askSayFn: undefined,
			askPushToolResultFn: undefined,
			askHandleErrorFn: undefined,
			askCheckpointFn: undefined,
			askResumeFn: undefined,
			askAbortFn: undefined,
			askDisposeFn: undefined,
			askPersistFn: undefined,
			askLoadFn: undefined,
			askSaveFn: undefined,
			askDeleteFn: undefined,
			askUpdateFn: undefined,
			askCreateFn: undefined,
			askExecuteFn: undefined,
			askValidateFn: undefined,
			askFormatFn: undefined,
			askParseFn: undefined,
			askNormalizeFn: undefined,
			askResolveFn: undefined,
			askRenderFn: undefined,
			askTrackFn: undefined,
			askReportFn: undefined,
			askNotifyFn: undefined,
			askLogFn: undefined,
			askWarnFn: undefined,
			taskErrorFn: undefined,
			askDebugFn: undefined,
			askTraceFn: undefined,
			askInfoFn: undefined,
			askStateFn: undefined,
			askResultFn: undefined,
			askProgressFn: undefined,
			askCompleteFn: undefined,
			askFailFn: undefined,
			askCancelFn: undefined,
			askStartFn: undefined,
			askEndFn: undefined,
			askResetFn: undefined,
			askClearFn: undefined,
			askInitFn: undefined,
			askDestroyFn: undefined,
			askCloseFn: undefined,
			askOpenFn: undefined,
			askFocusFn: undefined,
			askBlurFn: undefined,
			askSelectFn: undefined,
			askDeselectFn: undefined,
			askExpandFn: undefined,
			askCollapseFn: undefined,
			askPinFn: undefined,
			askUnpinFn: undefined,
			askLockFn: undefined,
			askUnlockFn: undefined,
			askHideFn: undefined,
			askShowFn: undefined,
			askEnableFn: undefined,
			askDisableFn: undefined,
			askMountFn: undefined,
			askUnmountFn: undefined,
			askAttachFn: undefined,
			askDetachFn: undefined,
			askListenFn: undefined,
			askUnlistenFn: undefined,
			askSubscribeFn: undefined,
			askUnsubscribeFn: undefined,
			askEmitFn: undefined,
			askDispatchFn: undefined,
		} as unknown as Task
	})

	function createCallbacks(approved = true): ToolCallbacks {
		return makeCallbacks(approved)
	}

	function buildCallbacks(approved = true): ToolCallbacks {
		return makeCallbacks(approved)
	}

	function makeCallbacks(approved = true): ToolCallbacks {
		return {
			askApproval: vi.fn().mockResolvedValue(approved),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
	}

	it("should have correct tool name", () => {
		expect(tool.name).toBe("open_tabs")
	})

	it("should handle missing urls parameter", async () => {
		const callbacks = makeCallbacks()
		await tool.execute({ urls: [] }, mockTask, callbacks)
		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("open_tabs")
		expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("open_tabs", "urls")
		expect(callbacks.pushToolResult).toHaveBeenCalledWith("Missing parameter error")
	})

	it("should ask approval once and open tabs on approval", async () => {
		const callbacks = makeCallbacks(true)
		vi.spyOn(browserLaunch, "openTabs").mockResolvedValue({
			browserUsed: "chrome",
			urls: ["https://www.google.com", "https://github.com"],
			openedCount: 2,
			usedExternalFallback: false,
		})

		await tool.execute(
			{
				urls: ["https://www.google.com", "https://github.com"],
				browser: "chrome",
				reuseExisting: true,
				visible: true,
			},
			mockTask,
			callbacks,
		)

		expect(callbacks.askApproval).toHaveBeenCalledTimes(1)
		expect(browserLaunch.openTabs).toHaveBeenCalledWith({
			urls: ["https://www.google.com", "https://github.com"],
			browser: "chrome",
			reuseExisting: true,
			visible: true,
		})
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Opened 2 tabs."))
	})

	it("should not open tabs when user rejects approval", async () => {
		const callbacks = makeCallbacks(false)
		await tool.execute({ urls: ["https://www.google.com"] }, mockTask, callbacks)
		expect(browserLaunch.openTabs).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})

	it("should surface helper errors through handleError", async () => {
		const callbacks = makeCallbacks(true)
		vi.spyOn(browserLaunch, "openTabs").mockRejectedValue(new Error("launch failed"))
		await tool.execute({ urls: ["https://www.google.com"] }, mockTask, callbacks)
		expect(callbacks.handleError).toHaveBeenCalledWith("opening browser tabs", expect.any(Error))
	})

	it("handlePartial should emit a tool ask once urls param stabilizes", async () => {
		mockTask.ask = vi.fn().mockResolvedValue(undefined)
		const partialBlock = {
			type: "tool_use",
			name: "open_tabs",
			params: {
				urls: '["https://www.google.com","https://github.com"]',
				browser: "chrome",
			},
			partial: true,
		} as unknown as ToolUse<"open_tabs">

		await tool.handlePartial(mockTask, partialBlock)
		await tool.handlePartial(mockTask, partialBlock)

		expect(mockTask.ask).toHaveBeenCalledWith("tool", expect.stringContaining("openTabs"), true)
	})
})
