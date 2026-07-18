import { describe, it, expect, beforeEach } from "vitest"
import { ResultInbox } from "../ResultInbox"

describe("ResultInbox", () => {
	let inbox: ResultInbox

	beforeEach(() => {
		inbox = new ResultInbox()
	})

	it("push/peek/collect with unread marking", () => {
		inbox.push({
			workerId: "w1",
			parentTaskId: "p1",
			name: "impl",
			role: "worker",
			kind: "completed",
			summary: "done A",
			attempt: 1,
		})
		inbox.push({
			workerId: "w2",
			parentTaskId: "p1",
			name: "tests",
			role: "worker",
			kind: "failed",
			error: "boom",
			attempt: 1,
		})
		inbox.push({
			workerId: "w3",
			parentTaskId: "p2",
			name: "other",
			role: "worker",
			kind: "completed",
			summary: "other parent",
			attempt: 1,
		})

		expect(inbox.peek("p1").length).toBe(2)
		expect(inbox.peek("p1", true).length).toBe(2)

		const collected = inbox.collect("p1", { unreadOnly: true, markRead: true })
		expect(collected.length).toBe(2)
		expect(inbox.peek("p1", true).length).toBe(0)
		expect(inbox.peek("p1", false).length).toBe(2)

		const text = inbox.formatForAgent(collected)
		expect(text).toContain('worker="impl"')
		expect(text).toContain("done A")
		expect(text).toContain("boom")
	})

	it("formatForAgent empty", () => {
		expect(inbox.formatForAgent([])).toBe("No worker results pending.")
	})

	it("formatForAgent includes question kind", () => {
		inbox.push({
			workerId: "w1",
			parentTaskId: "p1",
			name: "impl",
			role: "worker",
			kind: "question",
			summary: "Need credentials",
			attempt: 1,
		})
		const text = inbox.formatForAgent(inbox.collect("p1"))
		expect(text).toContain("[question]")
		expect(text).toContain("Need credentials")
	})

	it("formatForAgent includes review_digest body like completed summary", () => {
		inbox.push({
			workerId: "rev-1",
			parentTaskId: "p1",
			name: "fleet-reviewer",
			role: "reviewer",
			kind: "review_digest",
			summary: "2 implementers running; no rate_limited flags",
			attempt: 2,
		})
		const text = inbox.formatForAgent(inbox.collect("p1"))
		expect(text).toContain("[review_digest]")
		expect(text).toContain('worker="fleet-reviewer"')
		expect(text).toContain("role=reviewer")
		expect(text).toContain("2 implementers running; no rate_limited flags")
	})
})
