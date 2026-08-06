import { describe, expect, it, vi } from "vitest"

import { Task } from "../Task"

describe("Phase 0 completion reconciliation regression", () => {
	it("persists one canonical final output when text equals attempt_completion result", async () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).abort = false
		;(task as any).clineMessages = []
		;(task as any).lastMessageTs = undefined
		;(task as any).addToClineMessages = vi.fn(async (message) => {
			;(task as any).clineMessages.push(message)
		})
		;(task as any).saveClineMessages = vi.fn(async () => {})
		;(task as any).updateClineMessage = vi.fn(async () => {})

		const result = "Implemented the requested fix."
		await task.say("text", result, undefined, false)
		await task.say("completion_result", result, undefined, false)

		const canonicalFinals = (task as any).clineMessages.filter(
			(message: any) =>
				message.type === "say" &&
				(message.say === "text" || message.say === "completion_result") &&
				message.text === result,
		)

		expect(canonicalFinals).toHaveLength(1)
		expect(canonicalFinals[0].say).toBe("completion_result")
	})
})
