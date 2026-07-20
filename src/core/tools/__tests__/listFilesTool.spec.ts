import { describe, it, expect, vi, beforeEach } from "vitest"
import * as path from "path"

import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"
import type { ToolCallbacks } from "../BaseTool"
import { ListFilesTool, listFilesTool } from "../ListFilesTool"

vi.mock("../../../services/glob/list-files", async () => {
	const actual = await vi.importActual<typeof import("../../../services/glob/list-files")>(
		"../../../services/glob/list-files",
	)
	return { ...actual, listFiles: vi.fn() }
})

vi.mock("../../../utils/pathUtils", async () => {
	const actual = await vi.importActual<typeof import("../../../utils/pathUtils")>("../../../utils/pathUtils")
	return { ...actual, isPathOutsideWorkspace: vi.fn() }
})

vi.mock("../../../utils/path", async () => {
	const actual = await vi.importActual<typeof import("../../../utils/path")>("../../../utils/path")
	return { ...actual, getReadablePath: vi.fn() }
})

vi.mock("../../prompts/responses", async () => {
	const actual = await vi.importActual<typeof import("../../prompts/responses")>("../../prompts/responses")
	return {
		...actual,
		formatResponse: {
			...actual.formatResponse,
			formatFilesList: vi.fn(),
		},
	}
})

import * as listFilesModule from "../../../services/glob/list-files"
import * as pathUtilsModule from "../../../utils/pathUtils"
import * as pathModule from "../../../utils/path"
import { formatResponse } from "../../prompts/responses"

describe("ListFilesTool", () => {
	let tool: ListFilesTool
	let mockTask: Task
	let mockCallbacks: ToolCallbacks
	const TEST_WORKSPACE = path.resolve(path.sep, "test", "workspace")

	beforeEach(() => {
		vi.clearAllMocks()
		tool = new ListFilesTool()
		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			cwd: TEST_WORKSPACE,
			rooIgnoreController: undefined,
			rooProtectedController: undefined,
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({ showRooIgnoredFiles: false }),
				}),
			},
			ask: vi.fn().mockResolvedValue(undefined),
			askId: "task-1",
			askState: {},
			abort: false,
			userMessageContent: [],
			assistantMessageContent: [],
			askHistory: [],
			messageHistory: [],
			lastMessageTs: Date.now(),
		} as unknown as Task

		mockCallbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}

		vi.spyOn(listFilesModule, "listFiles").mockResolvedValue([[], false])
		vi.spyOn(pathUtilsModule, "isPathOutsideWorkspace").mockReturnValue(false)
		vi.spyOn(pathModule, "getReadablePath").mockReturnValue("src")
		vi.spyOn(formatResponse, "formatFilesList").mockReturnValue("formatted file list")
	})

	function createBlock(
		params: { path?: string; recursive?: boolean | string },
		partial = false,
	): ToolUse<"list_files"> {
		return {
			type: "tool_use",
			name: "list_files",
			params: params as any,
			partial,
		} as unknown as ToolUse<"list_files">
	}

	it("handles missing path parameter", async () => {
		await tool.execute({ path: "", recursive: false }, mockTask, mockCallbacks)
		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("list_files")
		expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("list_files", "path")
		expect((mockCallbacks as any).pushToolResult).toHaveBeenCalledWith("Missing parameter error")
	})

	it("lists files non-recursively", async () => {
		vi.mocked(listFilesModule.listFiles).mockResolvedValue([["file1.ts", "file2.ts"], false])
		vi.mocked(formatResponse.formatFilesList).mockReturnValue("src/\n  file1.ts\n  file2.ts")
		await tool.execute({ path: "src", recursive: false }, mockTask, mockCallbacks)
		const expectedPath = path.resolve(TEST_WORKSPACE, "src")
		expect(listFilesModule.listFiles).toHaveBeenCalledWith(expectedPath, false, 200)
		expect((mockCallbacks as any).askApproval).toHaveBeenCalledWith(
			"tool",
			expect.stringContaining("listFilesTopLevel"),
		)
		expect((mockCallbacks as any).pushToolResult).toHaveBeenCalledWith("src/\n  file1.ts\n  file2.ts")
	})

	it("lists files recursively", async () => {
		vi.mocked(listFilesModule.listFiles).mockResolvedValue([["file1.ts", "dir/file2.ts"], false])
		vi.mocked(formatResponse.formatFilesList).mockReturnValue("formatted recursive list")
		await tool.execute({ path: "src", recursive: true }, mockTask, mockCallbacks)
		expect(listFilesModule.listFiles).toHaveBeenCalledWith(path.resolve(TEST_WORKSPACE, "src"), true, 200)
		expect((mockCallbacks as any).askApproval).toHaveBeenCalledWith(
			"tool",
			expect.stringContaining("listFilesRecursive"),
		)
	})

	it("does not push result when approval is rejected", async () => {
		;(mockCallbacks as any).askApproval = vi.fn().mockResolvedValue(false)
		await tool.execute({ path: "src", recursive: false }, mockTask, mockCallbacks)
		expect((mockCallbacks as any).pushToolResult).not.toHaveBeenCalled()
	})

	it("passes ignore/protected controllers to formatter", async () => {
		const mockIgnoreController = { someMethod: vi.fn() }
		const mockProtectedController = { someMethod: vi.fn() }
		;(mockTask as any).rooIgnoreController = mockIgnoreController
		;(mockTask as any).rooProtectedController = mockProtectedController
		await tool.execute({ path: "src", recursive: false }, mockTask, mockCallbacks)
		expect(formatResponse.formatFilesList).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			mockIgnoreController,
			false,
			mockProtectedController,
		)
	})

	it("calls handleError when listFiles throws", async () => {
		const error = new Error("Filesystem error")
		vi.mocked(listFilesModule.listFiles).mockRejectedValue(error)
		await tool.execute({ path: "src", recursive: false }, mockTask, mockCallbacks)
		expect((mockCallbacks as any).handleError).toHaveBeenCalledWith("listing files", error)
	})

	it("handlePartial emits top-level listing message", async () => {
		vi.mocked(pathModule.getReadablePath).mockReturnValue("src")
		vi.mocked(pathUtilsModule.isPathOutsideWorkspace).mockReturnValue(false)
		;(mockTask as any).ask = vi.fn().mockResolvedValue(undefined)
		const block = createBlock({ path: "src", recursive: "false" }, true)
		await tool.handlePartial(mockTask, block)
		expect((mockTask as any).ask).toHaveBeenCalledWith("tool", expect.stringContaining("listFilesTopLevel"), true)
	})

	it("handlePartial emits recursive listing message", async () => {
		vi.mocked(pathModule.getReadablePath).mockReturnValue("src")
		;(mockTask as any).ask = vi.fn().mockResolvedValue(undefined)
		const block = createBlock({ path: "src", recursive: "true" }, true)
		await tool.handlePartial(mockTask, block)
		expect((mockTask as any).ask).toHaveBeenCalledWith("tool", expect.stringContaining("listFilesRecursive"), true)
	})

	it("exports singleton instance and correct name", () => {
		expect(listFilesTool).toBeInstanceOf(ListFilesTool)
		expect(listFilesTool.name).toBe("list_files")
		expect(tool.name).toBe("list_files")
	})
})
