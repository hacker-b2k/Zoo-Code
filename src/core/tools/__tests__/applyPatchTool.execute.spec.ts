import path from "path"
import fs from "fs/promises"

import type { MockedFunction } from "vitest"

import { ApplyPatchTool } from "../ApplyPatchTool"
import type { ToolCallbacks } from "../BaseTool"
import type { Task } from "../../task/Task"
import { fileExistsAtPath } from "../../../utils/fs"
import { isPathOutsideWorkspace, resolvePathInWorkspace, getWorkspaceReadablePath } from "../../../utils/pathUtils"
import { parsePatch, processAllHunks } from "../apply-patch"

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
		writeFile: vi.fn(),
		mkdir: vi.fn(),
		unlink: vi.fn(),
	},
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))

vi.mock("../../../utils/pathUtils", async () => {
	const actual = await vi.importActual<typeof import("../../../utils/pathUtils")>("../../../utils/pathUtils")
	return {
		...actual,
		isPathOutsideWorkspace: vi.fn(),
		resolvePathInWorkspace: vi.fn(),
		getWorkspaceReadablePath: vi.fn(),
	}
})

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		createPrettyPatch: vi.fn((filePath: string, oldContent: string, newContent: string) => {
			return `--- ${filePath}\n+++ ${filePath}\n-${oldContent}\n+${newContent}`
		}),
		rooIgnoreError: vi.fn((filePath: string) => `Access denied: ${filePath}`),
		toolError: vi.fn((message: string) => `Error: ${message}`),
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

vi.mock("../apply-patch", () => ({
	parsePatch: vi.fn(),
	processAllHunks: vi.fn(),
	ParseError: class ParseError extends Error {},
}))

describe("ApplyPatchTool.execute", () => {
	const cwd = path.join(path.sep, "workspace", "primary")
	const secondaryRoot = path.join(path.sep, "workspace", "secondary")

	const mockedReadFile = fs.readFile as MockedFunction<typeof fs.readFile>
	const mockedWriteFile = fs.writeFile as MockedFunction<typeof fs.writeFile>
	const mockedMkdir = fs.mkdir as MockedFunction<typeof fs.mkdir>
	const mockedUnlink = fs.unlink as MockedFunction<typeof fs.unlink>
	const mockedFileExistsAtPath = fileExistsAtPath as MockedFunction<typeof fileExistsAtPath>
	const mockedResolvePathInWorkspace = resolvePathInWorkspace as MockedFunction<typeof resolvePathInWorkspace>
	const mockedIsPathOutsideWorkspace = isPathOutsideWorkspace as MockedFunction<typeof isPathOutsideWorkspace>
	const mockedGetWorkspaceReadablePath = getWorkspaceReadablePath as MockedFunction<typeof getWorkspaceReadablePath>
	const mockedParsePatch = parsePatch as MockedFunction<typeof parsePatch>
	const mockedProcessAllHunks = processAllHunks as MockedFunction<typeof processAllHunks>

	let tool: ApplyPatchTool
	let task: any
	let callbacks: ToolCallbacks
	let askApproval: ReturnType<typeof vi.fn>
	let pushToolResult: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()

		tool = new ApplyPatchTool()
		askApproval = vi.fn().mockResolvedValue(true)
		pushToolResult = vi.fn()

		callbacks = {
			askApproval,
			pushToolResult,
			handleError: vi.fn(),
		}

		task = {
			cwd,
			consecutiveMistakeCount: 0,
			didEditFile: false,
			diffViewProvider: {
				editType: undefined,
				originalContent: undefined,
				open: vi.fn().mockResolvedValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				scrollToFirstDiff: vi.fn(),
				saveChanges: vi.fn().mockResolvedValue(undefined),
				saveDirectly: vi.fn().mockResolvedValue(undefined),
				pushToolWriteResult: vi.fn().mockResolvedValue("Tool result"),
				reset: vi.fn().mockResolvedValue(undefined),
				revertChanges: vi.fn().mockResolvedValue(undefined),
			},
			fileContextTracker: {
				trackFileContext: vi.fn().mockResolvedValue(undefined),
			},
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({
						diagnosticsEnabled: true,
						writeDelayMs: 25,
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
			processQueuedMessages: vi.fn(),
			recordToolError: vi.fn(),
			recordToolUsage: vi.fn(),
			say: vi.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing param"),
		}

		mockedReadFile.mockResolvedValue("")
		mockedWriteFile.mockResolvedValue(undefined)
		mockedMkdir.mockResolvedValue(undefined)
		mockedUnlink.mockResolvedValue(undefined)
		mockedFileExistsAtPath.mockResolvedValue(false)
		mockedResolvePathInWorkspace.mockImplementation(async (_cwd, filePath) => path.join(cwd, filePath))
		mockedIsPathOutsideWorkspace.mockReturnValue(false)
		mockedGetWorkspaceReadablePath.mockImplementation((_cwd, _absolutePath, fallbackPath) => fallbackPath ?? "file")
		mockedParsePatch.mockReturnValue({ hunks: [{}] } as any)
		mockedProcessAllHunks.mockResolvedValue([])
	})

	it("opens add-file diffs against the resolved secondary-root absolute path", async () => {
		const relPath = "nested/new-file.ts"
		const absolutePath = path.join(secondaryRoot, relPath)

		mockedResolvePathInWorkspace.mockResolvedValue(absolutePath)
		mockedGetWorkspaceReadablePath.mockReturnValue(`secondary/${relPath}`)
		mockedProcessAllHunks.mockResolvedValue([
			{
				type: "add",
				path: relPath,
				newContent: "export const value = 1\n",
			},
		] as any)

		await tool.execute(
			{ patch: "*** Begin Patch\n*** Add File: nested/new-file.ts\n*** End Patch" },
			task as Task,
			callbacks,
		)

		expect(task.rooIgnoreController.validateAccess).toHaveBeenCalledWith(absolutePath)
		expect(task.diffViewProvider.open).toHaveBeenCalledWith(absolutePath)
		expect(task.diffViewProvider.update).toHaveBeenCalledWith("export const value = 1\n", true)
		expect(askApproval).toHaveBeenCalledWith(
			"tool",
			expect.stringContaining(`"path":"secondary/${relPath}"`),
			undefined,
			false,
		)
		expect(task.fileContextTracker.trackFileContext).toHaveBeenCalledWith(relPath, "roo_edited")
		expect(pushToolResult).toHaveBeenCalledWith("Tool result")
	})

	it("writes moved files to the resolved secondary-root destination", async () => {
		const relPath = "src/original.ts"
		const absolutePath = path.join(cwd, relPath)
		const movePath = "secondary/moved.ts"
		const moveAbsolutePath = path.join(secondaryRoot, "moved.ts")

		mockedFileExistsAtPath.mockResolvedValue(true)
		mockedResolvePathInWorkspace.mockImplementation(async (_cwd, filePath) => {
			if (filePath === relPath) {
				return absolutePath
			}
			if (filePath === movePath) {
				return moveAbsolutePath
			}
			return path.join(cwd, filePath)
		})
		mockedGetWorkspaceReadablePath.mockImplementation((_cwd, absolute, fallbackPath) => {
			if (absolute === absolutePath) {
				return relPath
			}
			if (absolute === moveAbsolutePath) {
				return "secondary/moved.ts"
			}
			return fallbackPath ?? "file"
		})
		mockedProcessAllHunks.mockResolvedValue([
			{
				type: "update",
				path: relPath,
				originalContent: "old\n",
				newContent: "new\n",
				movePath,
			},
		] as any)

		await tool.execute(
			{ patch: "*** Begin Patch\n*** Update File: src/original.ts\n*** End Patch" },
			task as Task,
			callbacks,
		)

		expect(task.rooIgnoreController.validateAccess).toHaveBeenNthCalledWith(1, absolutePath)
		expect(task.rooIgnoreController.validateAccess).toHaveBeenNthCalledWith(2, moveAbsolutePath)
		expect(task.diffViewProvider.open).toHaveBeenCalledWith(relPath)
		expect(mockedMkdir).toHaveBeenCalledWith(path.dirname(moveAbsolutePath), { recursive: true })
		expect(mockedWriteFile).toHaveBeenCalledWith(moveAbsolutePath, "new\n", "utf8")
		expect(mockedUnlink).toHaveBeenCalledWith(absolutePath)
		expect(task.fileContextTracker.trackFileContext).toHaveBeenCalledWith(movePath, "roo_edited")
		expect(pushToolResult).toHaveBeenCalledWith("Tool result")
	})
})
