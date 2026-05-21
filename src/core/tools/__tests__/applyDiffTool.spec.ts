import fs from "fs/promises"

import type { MockedFunction } from "vitest"

import { fileExistsAtPath } from "../../../utils/fs"
import { getWorkspaceReadablePath, resolvePathInWorkspace } from "../../../utils/pathUtils"
import type { ToolUse } from "../../../shared/tools"
import { applyDiffTool } from "../ApplyDiffTool"

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
	},
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))

vi.mock("../../../utils/pathUtils", async () => {
	const actual = await vi.importActual<typeof import("../../../utils/pathUtils")>("../../../utils/pathUtils")
	return {
		...actual,
		resolvePathInWorkspace: vi.fn(),
		getWorkspaceReadablePath: vi.fn(),
	}
})

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		createPrettyPatch: vi.fn(() => "--- patch ---"),
		rooIgnoreError: vi.fn((filePath: string) => `Access denied: ${filePath}`),
	},
}))

vi.mock("../../diff/stats", () => ({
	sanitizeUnifiedDiff: vi.fn((diff: string) => diff),
	computeDiffStats: vi.fn(() => ({ additions: 1, deletions: 1 })),
}))

vi.mock("../../../shared/experiments", () => ({
	EXPERIMENT_IDS: {
		PREVENT_FOCUS_DISRUPTION: "prevent-focus-disruption",
	},
	experiments: {
		isEnabled: vi.fn().mockReturnValue(false),
	},
}))

describe("applyDiffTool", () => {
	const cwd = "/workspace/primary"
	const relPath = "secondary/file.ts"
	const absolutePath = "/workspace/secondary/file.ts"

	const mockedReadFile = fs.readFile as MockedFunction<typeof fs.readFile>
	const mockedFileExistsAtPath = fileExistsAtPath as MockedFunction<typeof fileExistsAtPath>
	const mockedResolvePathInWorkspace = resolvePathInWorkspace as MockedFunction<typeof resolvePathInWorkspace>
	const mockedGetWorkspaceReadablePath = getWorkspaceReadablePath as MockedFunction<typeof getWorkspaceReadablePath>

	let task: any
	let askApproval: ReturnType<typeof vi.fn>
	let pushToolResult: ReturnType<typeof vi.fn>
	let handleError: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()

		mockedReadFile.mockResolvedValue("old\n")
		mockedFileExistsAtPath.mockResolvedValue(true)
		mockedResolvePathInWorkspace.mockResolvedValue(absolutePath)
		mockedGetWorkspaceReadablePath.mockReturnValue("secondary/file.ts")

		task = {
			cwd,
			taskId: "task-123",
			api: {
				getModel: vi.fn().mockReturnValue({ id: "claude-3" }),
			},
			consecutiveMistakeCount: 0,
			consecutiveMistakeCountForApplyDiff: new Map(),
			didEditFile: false,
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({
						diagnosticsEnabled: true,
						writeDelayMs: 10,
						experiments: {},
					}),
				}),
			},
			rooIgnoreController: {
				validateAccess: vi.fn().mockReturnValue(true),
			},
			rooProtectedController: {
				isWriteProtected: vi.fn().mockReturnValue(false),
			},
			diffStrategy: {
				applyDiff: vi.fn().mockResolvedValue({ success: true, content: "new\n" }),
			},
			diffViewProvider: {
				editType: undefined,
				originalContent: "",
				open: vi.fn().mockResolvedValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				scrollToFirstDiff: vi.fn(),
				saveChanges: vi.fn().mockResolvedValue(undefined),
				revertChanges: vi.fn().mockResolvedValue(undefined),
				reset: vi.fn().mockResolvedValue(undefined),
				pushToolWriteResult: vi.fn().mockResolvedValue("Tool result"),
			},
			fileContextTracker: {
				trackFileContext: vi.fn().mockResolvedValue(undefined),
			},
			recordToolError: vi.fn(),
			recordToolUsage: vi.fn(),
			processQueuedMessages: vi.fn(),
			say: vi.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing param"),
		}

		askApproval = vi.fn().mockResolvedValue(true)
		pushToolResult = vi.fn()
		handleError = vi.fn()
	})

	it("uses the resolved path for access checks and the workspace-readable path in approval payloads", async () => {
		await applyDiffTool.execute({ path: relPath, diff: "@@ -1 +1 @@\n-old\n+new\n" }, task, {
			askApproval,
			pushToolResult,
			handleError,
		})

		expect(mockedResolvePathInWorkspace).toHaveBeenCalledWith(cwd, relPath)
		expect(task.rooIgnoreController.validateAccess).toHaveBeenCalledWith(absolutePath)
		expect(task.rooProtectedController.isWriteProtected).toHaveBeenCalledWith(absolutePath)
		expect(task.diffViewProvider.open).toHaveBeenCalledWith(absolutePath)
		expect(askApproval).toHaveBeenCalledWith(
			"tool",
			expect.stringContaining('"path":"secondary/file.ts"'),
			undefined,
			false,
		)
		expect(task.fileContextTracker.trackFileContext).toHaveBeenCalledWith(relPath, "roo_edited")
		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Tool result"))
	})

	it("uses the resolved workspace path in partial payloads after the path stabilizes", async () => {
		const block: ToolUse<"apply_diff"> = {
			type: "tool_use",
			name: "apply_diff",
			params: { path: relPath, diff: "@@ -1 +1 @@\n-old\n+new\n" },
			partial: true,
		}

		task.ask = vi.fn().mockResolvedValue(undefined)

		await applyDiffTool.handlePartial(task, block)
		await applyDiffTool.handlePartial(task, block)

		expect(task.ask).toHaveBeenCalledWith(
			"tool",
			expect.stringContaining('"path":"secondary/file.ts"'),
			true,
			undefined,
		)
	})
})
