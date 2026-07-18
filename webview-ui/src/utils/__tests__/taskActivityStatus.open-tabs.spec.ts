import { describe, it, expect } from "vitest"
import type { ClineMessage } from "@roo-code/types"

import { classifyActivity, summarizeActivity } from "../taskActivityStatus"

function makeSay(say: string, text?: string, ts = Date.now()): ClineMessage {
	return { type: "say", say: say as any, text: text ?? "", ts } as ClineMessage
}

function makeAsk(ask: string, text?: string, ts = Date.now()): ClineMessage {
	return { type: "ask", ask: ask as any, text: text ?? "", ts } as ClineMessage
}

function makeToolSay(toolName: string, extra: Record<string, unknown> = {}, ts = Date.now()): ClineMessage {
	return makeSay("tool", JSON.stringify({ tool: toolName, ...extra }), ts)
}

function makeToolAsk(toolName: string, extra: Record<string, unknown> = {}, ts = Date.now()): ClineMessage {
	return makeAsk("tool", JSON.stringify({ tool: toolName, ...extra }), ts)
}

describe("taskActivityStatus - openTabs", () => {
	it('classifies say:"tool" with openTabs as browsing', () => {
		const messages = [makeToolSay("openTabs", { urls: ["https://a.com"] })]
		expect(classifyActivity(messages)).toBe("browsing")
	})

	it('classifies ask:"tool" with openTabs as browsing', () => {
		const messages = [makeToolAsk("openTabs", { urls: ["https://a.com"] })]
		expect(classifyActivity(messages)).toBe("browsing")
	})

	it("counts openTabs as a tool use but not as a command/search/file counter", () => {
		const messages = [makeToolSay("openTabs", { urls: ["https://a.com", "https://b.com"] })]
		const summary = summarizeActivity(messages)
		expect(summary.toolUses).toBe(1)
		expect(summary.commands).toBe(0)
		expect(summary.searches).toBe(0)
		expect(summary.filesRead).toBe(0)
		expect(summary.filesEdited).toBe(0)
		expect(summary.filesCreated).toBe(0)
	})
})
