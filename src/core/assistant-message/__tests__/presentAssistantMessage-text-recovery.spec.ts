// npx vitest run core/assistant-message/__tests__/presentAssistantMessage-text-recovery.spec.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { presentAssistantMessage } from "../presentAssistantMessage"
import { applyTextualToolCallRecovery } from "../textToolCallRecovery"
import { resetTextToolCallSeqForTests } from "../TextToolCallParser"
import { writeSpecTool } from "../../tools/WriteSpecTool"
import { listFilesTool } from "../../tools/ListFilesTool"

vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureToolUsage: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
			captureException: vi.fn(),
			captureEvent: vi.fn(),
		},
	},
}))

const PRODUCTION_WRITE_SPEC_XML = `<tool_call>
<function=write_spec>
<parameter=title>Gaming Website - Steam Clone</parameter>
<parameter=spec_id>None</parameter>
<parameter=doc>requirements</parameter>
<parameter=content># Gaming Website Requirements</parameter>
<parameter=mode>replace</parameter>
</function>
</tool_call>`

describe("presentAssistantMessage — textual recovery execution path", () => {
	let mockTask: any
	let writeSpecSpy: ReturnType<typeof vi.spyOn>
	let listFilesSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		resetTextToolCallSeqForTests()

		// Spy on the same singleton instances presentAssistantMessage imports.
		writeSpecSpy = vi.spyOn(writeSpecTool, "handle").mockResolvedValue(undefined as any)
		listFilesSpy = vi.spyOn(listFilesTool, "handle").mockResolvedValue(undefined as any)

		mockTask = {
			taskId: "test-task-id",
			instanceId: "test-instance",
			abort: false,
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [],
			userMessageContent: [],
			didCompleteReadingStream: true,
			didRejectTool: false,
			didAlreadyUseTool: false,
			didToolFailInCurrentTurn: false,
			consecutiveMistakeCount: 0,
			clineMessages: [],
			apiConfiguration: { apiProvider: "openai" },
			api: {
				getModel: () => ({ id: "test-model", info: {} }),
			},
			recordToolUsage: vi.fn(),
			recordToolError: vi.fn(),
			toolRepetitionDetector: {
				check: vi.fn().mockReturnValue({ allowExecution: true }),
			},
			providerRef: {
				deref: () => ({
					getState: vi.fn().mockResolvedValue({
						mode: "code",
						customModes: [],
					}),
				}),
			},
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			diffViewProvider: { reset: vi.fn() },
			cwd: process.cwd(),
			getEffectiveModeSync: (fallback?: string) => fallback ?? "code",
		}

		mockTask.pushToolResultToUserContent = vi.fn().mockImplementation((toolResult: any) => {
			const existing = mockTask.userMessageContent.find(
				(b: any) => b.type === "tool_result" && b.tool_use_id === toolResult.tool_use_id,
			)
			if (existing) return false
			mockTask.userMessageContent.push(toolResult)
			return true
		})
	})

	afterEach(() => {
		writeSpecSpy.mockRestore()
		listFilesSpy.mockRestore()
	})

	it("executes write_spec recovered from MiniMax XML (E2E recovery → present)", async () => {
		const recovery = applyTextualToolCallRecovery({
			assistantMessage: PRODUCTION_WRITE_SPEC_XML,
			assistantMessageContent: [{ type: "text", content: PRODUCTION_WRITE_SPEC_XML, partial: true }],
			// OOB index after mid-stream text present — original non-execution bug
			currentStreamingContentIndex: 1,
		})
		expect(recovery.applied).toBe(true)

		// Task partialBlocks flip after history save
		for (const block of recovery.assistantMessageContent) {
			if ("partial" in block) block.partial = false
		}

		mockTask.assistantMessageContent = recovery.assistantMessageContent
		mockTask.currentStreamingContentIndex = recovery.currentStreamingContentIndex
		mockTask.userMessageContentReady = false

		await presentAssistantMessage(mockTask)

		expect(writeSpecSpy).toHaveBeenCalledTimes(1)
		const [, block] = writeSpecSpy.mock.calls[0] as [unknown, any, unknown]
		expect(block.name).toBe("write_spec")
		expect(block.id).toBeTruthy()
		expect(block.nativeArgs).toMatchObject({
			title: "Gaming Website - Steam Clone",
			spec_id: null,
			doc: "requirements",
		})
		expect(mockTask.userMessageContentReady).toBe(true)

		const didToolUse = mockTask.assistantMessageContent.some(
			(b: any) => b.type === "tool_use" || b.type === "mcp_tool_use",
		)
		expect(didToolUse).toBe(true)
	})

	it("executes JSON tool_call recovery (list_files)", async () => {
		const json = `<tool_call>{"name":"list_files","arguments":{"path":".","recursive":false}}</tool_call>`
		const recovery = applyTextualToolCallRecovery({
			assistantMessage: json,
			assistantMessageContent: [{ type: "text", content: json, partial: true }],
			currentStreamingContentIndex: 1,
		})
		expect(recovery.applied).toBe(true)
		for (const block of recovery.assistantMessageContent) {
			if ("partial" in block) block.partial = false
		}
		mockTask.assistantMessageContent = recovery.assistantMessageContent
		mockTask.currentStreamingContentIndex = recovery.currentStreamingContentIndex

		await presentAssistantMessage(mockTask)

		expect(listFilesSpy).toHaveBeenCalledTimes(1)
		const [, block] = listFilesSpy.mock.calls[0] as [unknown, any, unknown]
		expect(block.name).toBe("list_files")
		expect(block.nativeArgs).toMatchObject({ path: ".", recursive: false })
		expect(mockTask.userMessageContentReady).toBe(true)
	})

	it("does NOT present when index is OOB without recovery clamp (documents prior bug)", async () => {
		const recovery = applyTextualToolCallRecovery({
			assistantMessage: PRODUCTION_WRITE_SPEC_XML,
			assistantMessageContent: [{ type: "text", content: PRODUCTION_WRITE_SPEC_XML, partial: true }],
			currentStreamingContentIndex: 1,
		})
		for (const block of recovery.assistantMessageContent) {
			if ("partial" in block) block.partial = false
		}

		// Force pre-fix OOB index (original commit behavior)
		mockTask.assistantMessageContent = recovery.assistantMessageContent
		mockTask.currentStreamingContentIndex = recovery.assistantMessageContent.length
		mockTask.didCompleteReadingStream = true
		mockTask.userMessageContentReady = false

		await presentAssistantMessage(mockTask)

		expect(writeSpecSpy).not.toHaveBeenCalled()
		expect(mockTask.userMessageContentReady).toBe(true)
	})

	it("native tool_use still executes without text recovery", async () => {
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: "native_list_1",
				name: "list_files",
				params: {},
				partial: false,
				nativeArgs: { path: "src", recursive: true },
			},
		]
		mockTask.currentStreamingContentIndex = 0

		await presentAssistantMessage(mockTask)

		expect(listFilesSpy).toHaveBeenCalledTimes(1)
		expect(writeSpecSpy).not.toHaveBeenCalled()
	})
})
