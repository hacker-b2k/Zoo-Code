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
			expect(state.systemPromptVariant).toBe("native")
			expect(state.shouldShowNoToolsBanner).toBe(false)
			expect(state.consecutiveNoToolCountValue).toBe(0)
			expect(state.textOnlyResponseCountValue).toBe(0)
		})
	})

	describe("reportNativeTool", () => {
		it("marks provider native and resets counters", () => {
			state.reportNoTool()
			state.reportNoTool()
			expect(state.providerModeValue).toBe("text_only")

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

		it("second no-tool locks text_only and shows banner", () => {
			state.reportNoTool()
			state.reportNoTool()

			expect(state.providerModeValue).toBe("text_only")
			expect(state.shouldSendTools).toBe(false)
			expect(state.shouldInjectTextMode).toBe(true)
			expect(state.systemPromptVariant).toBe("text")
			expect(state.shouldShowNoToolsBanner).toBe(true)
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
			// Banner still allowed for native models that skip tools
			expect(state.shouldShowNoToolsBanner).toBe(true)
			expect(state.consecutiveNoToolCountValue).toBe(2)
		})

		it("after text_recovered then two no-tool turns becomes text_only", () => {
			state.reportTextRecovery()
			expect(state.providerModeValue).toBe("text_recovered")
			expect(state.shouldSendTools).toBe(true)

			state.beginTurn()
			state.reportNoTool()
			expect(state.providerModeValue).toBe("text_recovered")
			expect(state.shouldShowNoToolsBanner).toBe(false)

			state.beginTurn()
			state.reportNoTool()
			expect(state.providerModeValue).toBe("text_only")
			expect(state.shouldSendTools).toBe(false)
			expect(state.shouldShowNoToolsBanner).toBe(true)
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
			expect(state.providerModeValue).toBe("text_only")

			state.reset()

			expect(state.providerModeValue).toBe("unknown")
			expect(state.didToolUse).toBe(false)
			expect(state.shouldSendTools).toBe(true)
			expect(state.shouldInjectTextMode).toBe(false)
			expect(state.systemPromptVariant).toBe("native")
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
			expect(["text_recovered", "text_only"]).toContain(state.providerModeValue)
		})
	})
})
