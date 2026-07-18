// npx vitest run src/core/tools/__tests__/executeCommandTool.spec.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ToolUsage } from "@roo-code/types"
import * as vscode from "vscode"

import type { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import type { ToolUse, AskApproval, HandleError, PushToolResult } from "../../../shared/tools"
import { unescapeHtmlEntities } from "../../../utils/text-normalization"
import { Terminal } from "../../../integrations/terminal/Terminal"

vi.mock("execa", async () => {
	const actual = await vi.importActual<any>("execa")
	return {
		...actual,
		execa: vi.fn(),
		ExecaError: actual.ExecaError ?? class ExecaError extends Error {},
	}
})

vi.mock("fs/promises", () => ({
	default: {
		access: vi.fn().mockResolvedValue(undefined),
	},
}))

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
}))

vi.mock("../../task/Task")
vi.mock("../../prompts/responses", async () => {
	const actual = await vi.importActual<typeof import("../../prompts/responses")>("../../prompts/responses")
	return {
		...actual,
		formatResponse: {
			...actual.formatResponse,
			rooIgnoreError: vi.fn((p: string) => `RooIgnore error: ${p}`),
			toolResult: vi.fn((text: string) => text),
		},
	}
})

vi.mock("../../../integrations/terminal/TerminalRegistry", async () => {
	const actual = await vi.importActual<typeof import("../../../integrations/terminal/TerminalRegistry")>(
		"../../../integrations/terminal/TerminalRegistry",
	)
	return {
		...actual,
		TerminalRegistry: {
			...actual.TerminalRegistry,
			getOrCreateTerminal: vi.fn(),
		},
	}
})

import * as executeCommandModule from "../ExecuteCommandTool"
import * as terminalRegistryModule from "../../../integrations/terminal/TerminalRegistry"

const { executeCommandTool } = executeCommandModule

describe("executeCommandTool", () => {
	let mockCline: any & { consecutiveMistakeCount: number; didRejectTool: boolean }
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockToolUse: ToolUse<"execute_command">
	const originalCliRuntime = process.env.ROO_CLI_RUNTIME

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useRealTimers()

		mockCline = {
			taskId: "task-1",
			ask: vi.fn().mockResolvedValue(undefined),
			say: vi.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			consecutiveMistakeCount: 0,
			didRejectTool: false,
			rooIgnoreController: {
				validateCommand: vi.fn().mockReturnValue(null),
			},
			recordToolUsage: vi.fn().mockReturnValue({} as ToolUsage),
			recordToolError: vi.fn(),
			providerRef: {
				deref: vi.fn().mockResolvedValue({
					getState: vi.fn().mockResolvedValue({
						terminalOutputLineLimit: 500,
						terminalOutputCharacterLimit: 100000,
						terminalShellIntegrationDisabled: true,
					}),
					postMessageToWebview: vi.fn(),
				}),
			},
			lastMessageTs: Date.now(),
			cwd: "/test/workspace",
			terminalProcess: undefined,
			supersedePendingAsk: vi.fn(),
		} as any

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn().mockResolvedValue(undefined)
		mockPushToolResult = vi.fn()

		const mockConfig = {
			get: vi.fn().mockImplementation((_key: string, defaultValue: any) => defaultValue),
		}
		;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)

		const fakeProcess = Object.assign(Promise.resolve(), {
			continue: vi.fn(),
			abort: vi.fn(),
		})

		vi.spyOn(terminalRegistryModule.TerminalRegistry, "getOrCreateTerminal").mockResolvedValue({
			runCommand: vi.fn().mockImplementation(async (_command: string, callbacks: any) => {
				callbacks.onShellExecutionStarted?.(123)
				callbacks.onShellExecutionComplete?.({ exitCode: 0 })
				await callbacks.onCompleted?.("Command executed")
				return fakeProcess
			}),
			getCurrentWorkingDirectory: vi.fn().mockReturnValue("/test/workspace"),
		} as any)

		mockToolUse = {
			type: "tool_use",
			name: "execute_command",
			params: {
				command: "echo test",
			},
			nativeArgs: {
				command: "echo test",
			},
			partial: false,
		}
	})

	afterEach(() => {
		process.env.ROO_CLI_RUNTIME = originalCliRuntime
		vi.useRealTimers()
	})

	describe("HTML entity unescaping", () => {
		it("should unescape < to < character", () => {
			const input = "echo <test>"
			const expected = "echo <test>"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should unescape > to > character", () => {
			const input = "echo test > output.txt"
			const expected = "echo test > output.txt"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should unescape & to & character", () => {
			const input = "echo foo && echo bar"
			const expected = "echo foo && echo bar"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should handle multiple mixed HTML entities", () => {
			const input = "grep -E 'pattern' <file.txt >output.txt 2>&1"
			const expected = "grep -E 'pattern' <file.txt >output.txt 2>&1"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})
	})

	describe("Basic functionality", () => {
		it("should execute a command normally", async () => {
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as AskApproval,
				handleError: mockHandleError as HandleError,
				pushToolResult: mockPushToolResult as PushToolResult,
			})
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test")
			expect(mockPushToolResult).toHaveBeenCalled()
			expect(String(mockPushToolResult.mock.calls[0][0])).toContain("Command executed")
		})

		it("should pass along custom working directory if provided", async () => {
			mockToolUse.params.cwd = "/custom/path"
			mockToolUse.nativeArgs = { command: "echo test", cwd: "/custom/path" }
			vi.spyOn(terminalRegistryModule.TerminalRegistry, "getOrCreateTerminal").mockResolvedValue({
				runCommand: vi.fn().mockImplementation(async (_command: string, callbacks: any) => {
					callbacks.onShellExecutionStarted?.(123)
					callbacks.onShellExecutionComplete?.({ exitCode: 0 })
					await callbacks.onCompleted?.("Command executed")
					return Object.assign(Promise.resolve(), { continue: vi.fn(), abort: vi.fn() })
				}),
				getCurrentWorkingDirectory: vi.fn().mockReturnValue("/custom/path"),
			} as any)
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as AskApproval,
				handleError: mockHandleError as HandleError,
				pushToolResult: mockPushToolResult as PushToolResult,
			})
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test")
			expect(String(mockPushToolResult.mock.calls[0][0])).toContain("/custom/path")
		})
	})

	describe("Error handling", () => {
		it("should handle missing command parameter", async () => {
			mockToolUse.params.command = undefined
			mockToolUse.nativeArgs = { command: "" }
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as AskApproval,
				handleError: mockHandleError as HandleError,
				pushToolResult: mockPushToolResult as PushToolResult,
			})
			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("execute_command", "command")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
			expect(mockAskApproval).not.toHaveBeenCalled()
		})

		it("should handle command rejection", async () => {
			mockAskApproval.mockResolvedValue(false)
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as AskApproval,
				handleError: mockHandleError as HandleError,
				pushToolResult: mockPushToolResult as PushToolResult,
			})
			expect(mockPushToolResult).not.toHaveBeenCalled()
		})

		it("should handle rooignore validation failures", async () => {
			mockToolUse.params.command = "cat .env"
			mockToolUse.nativeArgs = { command: "cat .env" }
			const validateCommandMock = vi.fn().mockReturnValue(".env")
			mockCline.rooIgnoreController = { validateCommand: validateCommandMock }
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as AskApproval,
				handleError: mockHandleError as HandleError,
				pushToolResult: mockPushToolResult as PushToolResult,
			})
			expect(validateCommandMock).toHaveBeenCalledWith("cat .env")
			expect(mockCline.say).toHaveBeenCalledWith("rooignore_error", ".env")
			expect(mockPushToolResult).toHaveBeenCalledWith(formatResponse.rooIgnoreError(".env"))
			expect(mockAskApproval).not.toHaveBeenCalled()
		})
	})

	describe("helper functions", () => {
		it("allows Execa retry when shell integration fails before command submission", () => {
			const error = new executeCommandModule.ShellIntegrationError("startup failed", false)
			expect(executeCommandModule.canRetryShellIntegrationError(error)).toBe(true)
		})

		it("prevents Execa retry when shell integration fails after command submission", () => {
			const error = new executeCommandModule.ShellIntegrationError("stream missing", true)
			expect(executeCommandModule.canRetryShellIntegrationError(error)).toBe(false)
		})

		it("selects the Execa fallback provider for cmd.exe shell integration", () => {
			vi.spyOn(Terminal, "isActiveShellCmdExe").mockReturnValue(true)
			expect(executeCommandModule.getTerminalProviderForExecution(false)).toEqual({
				terminalProvider: "execa",
				isCmdExeFallback: true,
			})
		})

		it("ignores model timeout in CLI runtime", () => {
			process.env.ROO_CLI_RUNTIME = "1"
			expect(executeCommandModule.resolveAgentTimeoutMs(30)).toBe(0)
		})

		it("honors model timeout outside CLI runtime", () => {
			delete process.env.ROO_CLI_RUNTIME
			expect(executeCommandModule.resolveAgentTimeoutMs(30)).toBe(30_000)
		})
	})
})
