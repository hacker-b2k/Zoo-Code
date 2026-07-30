// npx vitest run src/core/assistant-message/__tests__/ToolCallDetectionState.spec.ts

import { describe, it, expect, beforeEach } from "vitest"
import { ToolCallDetectionState } from "../ToolCallDetectionState"

describe("ToolCallDetectionState", () => {
	let state: ToolCallDetectionState

	beforeEach(() => {
		state = new ToolCallDetectionState()
	})

	describe("initial state", () => {
		it("starts unknown with no tools this turn", () => {
			expect(state.providerModeValue).toBe("unknown")
			expect(state.didToolUse).toBe(false)
			expect(state.shouldSendTools).toBe(true)
			expect(state.shouldInjectTextMode).toBe(false)
			// Unknown provider defaults to "dual" mode — both native and text
			// instructions so the model is prepared for either path without
			// being told "your provider doesn't support tools" (identity confusion).
			expect(state.systemPromptVariant).toBe("dual")
			expect(state.shouldShowNoToolsBanner).toBe(false)
			expect(state.consecutiveNoToolCountValue).toBe(0)
			expect(state.textOnlyResponseCountValue).toBe(0)
		})
	})

	describe("reportNativeTool", () => {
		it("marks provider native and resets counters", () => {
			state.reportNoTool()
			state.reportNoTool()
			// No-lock: never becomes text_only
			expect(state.providerModeValue).toBe("unknown")

			state.reportNativeTool()

			expect(state.providerModeValue).toBe("native")
			expect(state.didToolUse).toBe(true)
			expect(state.consecutiveNoToolCountValue).toBe(0)
			expect(state.textOnlyResponseCountValue).toBe(0)
			expect(state.shouldSendTools).toBe(true)
			expect(state.shouldInjectTextMode).toBe(false)
			expect(state.systemPromptVariant).toBe("native")
			expect(state.shouldShowNoToolsBanner).toBe(false)
		})

		it("supersedes text_recovered", () => {
			state.reportTextRecovery()
			expect(state.providerModeValue).toBe("text_recovered")

			state.reportNativeTool()
			expect(state.providerModeValue).toBe("native")
			expect(state.systemPromptVariant).toBe("native")
		})
	})

	describe("reportTextRecovery / reportProseRecovery", () => {
		it("marks text_recovered and never native", () => {
			state.reportTextRecovery()

			expect(state.providerModeValue).toBe("text_recovered")
			expect(state.didToolUse).toBe(true)
			expect(state.shouldSendTools).toBe(true)
			expect(state.shouldInjectTextMode).toBe(true)
			expect(state.systemPromptVariant).toBe("text")
			expect(state.shouldShowNoToolsBanner).toBe(false)
			expect(state.consecutiveNoToolCountValue).toBe(0)
		})

		it("reportProseRecovery has same provider semantics as text recovery", () => {
			state.reportProseRecovery()

			expect(state.providerModeValue).toBe("text_recovered")
			expect(state.didToolUse).toBe(true)
			expect(state.shouldInjectTextMode).toBe(true)
		})

		it("does not downgrade native to text_recovered", () => {
			state.reportNativeTool()
			state.beginTurn()
			state.reportTextRecovery()

			// toolsThisTurn becomes true again, but mode stays native
			expect(state.providerModeValue).toBe("native")
			expect(state.didToolUse).toBe(true)
			expect(state.systemPromptVariant).toBe("native")
		})

		it("resets consecutive no-tool count when recovery succeeds", () => {
			state.reportNoTool()
			expect(state.consecutiveNoToolCountValue).toBe(1)

			state.reportTextRecovery()
			expect(state.consecutiveNoToolCountValue).toBe(0)
			expect(state.shouldShowNoToolsBanner).toBe(false)
		})
	})

	describe("reportNoTool", () => {
		it("first no-tool injects text mode but does not show banner", () => {
			state.reportNoTool()

			expect(state.providerModeValue).toBe("unknown")
			expect(state.didToolUse).toBe(false)
			expect(state.textOnlyResponseCountValue).toBe(1)
			expect(state.consecutiveNoToolCountValue).toBe(1)
			expect(state.shouldInjectTextMode).toBe(true)
			expect(state.systemPromptVariant).toBe("text")
			expect(state.shouldShowNoToolsBanner).toBe(false)
			expect(state.shouldSendTools).toBe(true)
		})

		it("second no-tool stays unknown (no lock-in) and still sends tools", () => {
			state.reportNoTool()
			state.reportNoTool()

			// No-lock: never becomes text_only, always sends tools
			expect(state.providerModeValue).toBe("unknown")
			expect(state.shouldSendTools).toBe(true)
			expect(state.shouldInjectTextMode).toBe(true)
			expect(state.systemPromptVariant).toBe("text")
			expect(state.shouldShowNoToolsBanner).toBe(false)
			expect(state.consecutiveNoToolCountValue).toBe(2)
		})

		it("does not flip a proven-native provider to text_only", () => {
			state.reportNativeTool()
			state.beginTurn()
			state.reportNoTool()
			state.reportNoTool()

			expect(state.providerModeValue).toBe("native")
			expect(state.shouldSendTools).toBe(true)
			expect(state.shouldInjectTextMode).toBe(false)
			expect(state.systemPromptVariant).toBe("native")
			// Banner threshold is now 3 — 2 no-tools won't show it
			expect(state.shouldShowNoToolsBanner).toBe(false)
			expect(state.consecutiveNoToolCountValue).toBe(2)
		})

		it("after text_recovered then no-tool turns stays text_recovered (no lock-in)", () => {
			state.reportTextRecovery()
			expect(state.providerModeValue).toBe("text_recovered")
			expect(state.shouldSendTools).toBe(true)

			state.beginTurn()
			state.reportNoTool()
			expect(state.providerModeValue).toBe("text_recovered")
			expect(state.shouldShowNoToolsBanner).toBe(false)

			state.beginTurn()
			state.reportNoTool()
			// No-lock: stays text_recovered, never becomes text_only
			expect(state.providerModeValue).toBe("text_recovered")
			expect(state.shouldSendTools).toBe(true)
			expect(state.shouldShowNoToolsBanner).toBe(false)
		})
	})

	describe("reportNoTool with conversational flag", () => {
		it("conversational no-tool does NOT count toward text-mode injection", () => {
			// Greetings/questions correctly don't use tools — not a provider issue.
			state.reportNoTool(true)

			expect(state.providerModeValue).toBe("unknown")
			expect(state.didToolUse).toBe(false)
			// textOnlyResponseCount stays 0 — no text-mode injection
			expect(state.textOnlyResponseCountValue).toBe(0)
			expect(state.shouldInjectTextMode).toBe(false)
			// System prompt stays "dual" (unknown default), not "text"
			expect(state.systemPromptVariant).toBe("dual")
			expect(state.shouldSendTools).toBe(true)
		})

		it("conversational no-tool DOES increment banner counter", () => {
			state.reportNoTool(true)
			expect(state.consecutiveNoToolCountValue).toBe(1)
			expect(state.shouldShowNoToolsBanner).toBe(false)
		})

		it("conversational greeting then action request: only action counts", () => {
			// First turn: "hi" (conversational) — no injection
			state.reportNoTool(true)
			expect(state.textOnlyResponseCountValue).toBe(0)
			expect(state.shouldInjectTextMode).toBe(false)
			expect(state.systemPromptVariant).toBe("dual")

			// Second turn: action request fails — counts toward text-mode injection
			state.beginTurn()
			state.reportNoTool(false)
			expect(state.textOnlyResponseCountValue).toBe(1)
			expect(state.shouldInjectTextMode).toBe(true)
			expect(state.systemPromptVariant).toBe("text")
		})
	})

	describe("systemPromptVariant modes", () => {
		it("unknown provider defaults to dual mode", () => {
			expect(state.systemPromptVariant).toBe("dual")
		})

		it("native provider stays native", () => {
			state.reportNativeTool()
			expect(state.systemPromptVariant).toBe("native")
		})

		it("text_recovered provider uses text mode", () => {
			state.reportTextRecovery()
			expect(state.systemPromptVariant).toBe("text")
		})
	})

	describe("beginTurn", () => {
		it("clears didToolUse for the new turn without resetting provider mode", () => {
			state.reportNativeTool()
			expect(state.didToolUse).toBe(true)

			state.beginTurn()
			expect(state.didToolUse).toBe(false)
			expect(state.providerModeValue).toBe("native")
		})
	})

	describe("reset", () => {
		it("returns to initial unknown state", () => {
			state.reportNoTool()
			state.reportNoTool()
			// No-lock: never becomes text_only
			expect(state.providerModeValue).toBe("unknown")

			state.reset()

			expect(state.providerModeValue).toBe("unknown")
			expect(state.didToolUse).toBe(false)
			expect(state.shouldSendTools).toBe(true)
			expect(state.shouldInjectTextMode).toBe(false)
			// Reset returns to "dual" mode (unknown provider default).
			expect(state.systemPromptVariant).toBe("dual")
			expect(state.shouldShowNoToolsBanner).toBe(false)
			expect(state.consecutiveNoToolCountValue).toBe(0)
			expect(state.textOnlyResponseCountValue).toBe(0)
		})
	})

	describe("corruption regression: recovery must not mark native", () => {
		it("text recovery then no-tool never reports native mode", () => {
			state.reportTextRecovery()
			state.beginTurn()
			state.reportNoTool()
			state.beginTurn()
			state.reportProseRecovery()
			state.beginTurn()
			state.reportNoTool()

			expect(state.providerModeValue).not.toBe("native")
			expect(state.providerModeValue).toBe("text_recovered")
		})
	})
})
