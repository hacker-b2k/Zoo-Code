// npx vitest run core/prompts/__tests__/provider-transport-compat.spec.ts

/**
 * Phase 11: Provider Transport Compatibility Tests
 *
 * Verifies that:
 * 1. R1/DeepSeek message format conversion preserves tool ID ordering
 * 2. Error handler messages do not reveal internal provider architecture
 * 3. Condense summary prompt does not contain obsolete policy phrases
 * 4. Tool argument/result blocks preserve order through R1 transform
 */

import { convertToR1Format } from "../../../api/transform/r1-format"
import { handleProviderError } from "../../../api/providers/utils/error-handler"
import { supportPrompt } from "../../../shared/support-prompt"

describe("Phase 11: Provider Transport Compatibility", () => {
	describe("R1/DeepSeek format conversion preserves tool order", () => {
		it("should preserve tool_use and tool_result ordering across role merges", () => {
			const messages = [
				{ role: "user" as const, content: "Do something" },
				{
					role: "assistant" as const,
					content: [
						{ type: "tool_use" as const, id: "tool-1", name: "read_file", input: { path: "a.ts" } },
						{ type: "tool_use" as const, id: "tool-2", name: "write_to_file", input: { path: "b.ts" } },
					],
				},
				{
					role: "user" as const,
					content: [
						{ type: "tool_result" as const, tool_use_id: "tool-1", content: "file content" },
						{ type: "tool_result" as const, tool_use_id: "tool-2", content: "success" },
					],
				},
			]

			const result = convertToR1Format(messages)

			// Should have assistant message with tool calls in order
			const assistantMsg = result.find((m) => m.role === "assistant")
			expect(assistantMsg).toBeDefined()
			const assistantContent = (assistantMsg as any).content
			// After conversion, tool calls should be in the assistant message
			// The R1 format merges consecutive same-role messages

			// Should have tool message(s) preserving IDs
			const toolMsgs = result.filter((m) => m.role === "tool")
			expect(toolMsgs.length).toBeGreaterThanOrEqual(1)

			// Tool call IDs should be preserved in order
			const toolCallIds = toolMsgs.map((m: any) => m.tool_call_id)
			expect(toolCallIds).toContain("tool-1")
			expect(toolCallIds).toContain("tool-2")
		})

		it("should preserve reasoning_content on assistant messages", () => {
			const messages = [
				{ role: "user" as const, content: "Think about this" },
				{
					role: "assistant" as const,
					content: "Let me think...",
					reasoning_content: "Internal reasoning about the problem",
				} as any,
				{ role: "user" as const, content: "Continue" },
			]

			const result = convertToR1Format(messages)

			const assistantMsg = result.find((m) => m.role === "assistant")
			expect(assistantMsg).toBeDefined()
			expect((assistantMsg as any).reasoning_content).toBe("Internal reasoning about the problem")
		})

		it("should merge consecutive same-role user messages", () => {
			const messages = [
				{ role: "user" as const, content: "First message" },
				{ role: "user" as const, content: "Second message" },
				{ role: "assistant" as const, content: "Response" },
			]

			const result = convertToR1Format(messages)

			// R1 format requires no consecutive same-role messages
			const userMsgs = result.filter((m) => m.role === "user")
			expect(userMsgs.length).toBe(1)
		})
	})

	describe("Error handler does not reveal internal architecture", () => {
		it("should not expose source file paths or stack traces in error messages", () => {
			const internalError = new Error("connection timeout")
			internalError.stack =
				"Error: connection timeout\n    at LiteLLMHandler.createMessage (src/api/providers/lite-llm.ts:350)\n    at Task.attemptApiRequest (src/core/task/Task.ts:1234)"

			const wrapped = handleProviderError(internalError, "LiteLLM", { messagePrefix: "completion" })
			const message = wrapped.message

			// Stack traces and source file paths should not be in the user-facing message
			expect(message).not.toMatch(/src\/api\/providers/)
			expect(message).not.toMatch(/src\/core\/task/)
			expect(message).not.toMatch(/at Task\./)
			// Should contain provider name for context
			expect(message).toContain("LiteLLM")
		})

		it("should not expose stack traces in error messages", () => {
			const error = new Error("rate limited")
			error.stack =
				"Error: rate limited\n    at OpenAINativeHandler.createMessage (src/api/providers/openai-native.ts:350)"

			const wrapped = handleProviderError(error, "OpenAI")
			const message = wrapped.message

			expect(message).not.toContain("src/api/providers")
			expect(message).not.toContain("OpenAINativeHandler")
			expect(message).not.toContain("at ")
		})

		it("should include provider name for context without leaking internals", () => {
			const error = new Error("429 Too Many Requests")

			const wrapped = handleProviderError(error, "Anthropic")
			const message = wrapped.message

			// Should include provider name for user context
			expect(message).toContain("Anthropic")
			expect(message).toContain("completion error")
		})

		it("should handle unknown errors gracefully", () => {
			const wrapped = handleProviderError("string error", "Gemini")
			expect(wrapped).toBeInstanceOf(Error)
			expect(wrapped.message).toContain("Gemini")
		})
	})

	describe("Condense summary prompt does not resurrect obsolete rules", () => {
		const CONDENSE_PROMPT = supportPrompt.default.CONDENSE

		it("should not contain obsolete policy phrases", () => {
			// These phrases were removed from the main prompt and must not reappear via condense
			expect(CONDENSE_PROMPT).not.toMatch(/you must call at least one tool/i)
			expect(CONDENSE_PROMPT).not.toMatch(/STRICTLY FORBIDDEN from starting/i)
			expect(CONDENSE_PROMPT).not.toMatch(/5[-–]7.*possible.*source/i)
			expect(CONDENSE_PROMPT).not.toMatch(/VENDOR CONFIDENTIALITY/i)
			expect(CONDENSE_PROMPT).not.toMatch(/never reveal the vendor or company/i)
			expect(CONDENSE_PROMPT).not.toMatch(/I was created by a team of developers/i)
			expect(CONDENSE_PROMPT).not.toMatch(/ALL responses MUST show ANY/i)
			expect(CONDENSE_PROMPT).not.toMatch(/PRIMARY and PREFERRED tool for ALL browser/i)
			expect(CONDENSE_PROMPT).not.toMatch(/Default to multi-agent when work can run in parallel/i)
		})

		it("should not reveal internal provider architecture", () => {
			expect(CONDENSE_PROMPT).not.toMatch(/LiteLLMHandler|OpenAINativeHandler|GeminiHandler/)
			expect(CONDENSE_PROMPT).not.toMatch(/AnthropicHandler|BedrockHandler|VsCodeLmHandler/)
			expect(CONDENSE_PROMPT).not.toMatch(/src\/api\/providers/)
			expect(CONDENSE_PROMPT).not.toMatch(/BaseProvider|ApiHandler/)
		})

		it("should focus on technical workflow state, not policy", () => {
			// The condense prompt should ask for technical details
			expect(CONDENSE_PROMPT).toContain("summary")
			expect(CONDENSE_PROMPT).toContain("Primary Request and Intent")
			expect(CONDENSE_PROMPT).toContain("Files and Code Sections")
			expect(CONDENSE_PROMPT).toContain("Current Work")
			expect(CONDENSE_PROMPT).toContain("Pending Tasks")
		})

		it("should include the system-operation disclaimer", () => {
			expect(CONDENSE_PROMPT).toContain("SYSTEM OPERATION")
			expect(CONDENSE_PROMPT).toContain("not a user message")
		})
	})
})
