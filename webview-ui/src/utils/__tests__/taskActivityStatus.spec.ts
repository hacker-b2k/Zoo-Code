import type { ClineMessage } from "@roo-code/types"

import { classifyActivity, summarizeActivity } from "../taskActivityStatus"
import type { ActivitySummary } from "../taskActivityStatus"
import { deriveTaskActivityViewModel } from "../taskActivityViewModel"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSay(say: string, text?: string, ts = Date.now()): ClineMessage {
	return { type: "say", say: say as any, text: text ?? "", ts } as ClineMessage
}

function makeAsk(ask: string, text?: string, ts = Date.now()): ClineMessage {
	return { type: "ask", ask: ask as any, text: text ?? "", ts } as ClineMessage
}

function makeToolSay(toolName: string, path?: string, ts = Date.now()): ClineMessage {
	return makeSay("tool", JSON.stringify({ tool: toolName, path: path ?? "/file.ts" }), ts)
}

function makeToolAsk(toolName: string, path?: string, ts = Date.now()): ClineMessage {
	return makeAsk("tool", JSON.stringify({ tool: toolName, path: path ?? "/file.ts" }), ts)
}

// ---------------------------------------------------------------------------
// classifyActivity — backward-scanning
// ---------------------------------------------------------------------------

describe("classifyActivity", () => {
	it('returns "activity" for an empty message array', () => {
		expect(classifyActivity([])).toBe("activity")
	})

	// ---- say messages ----

	it('classifies say:"reasoning" as thinking', () => {
		const messages = [makeSay("reasoning", "chain of thought")]
		expect(classifyActivity(messages)).toBe("thinking")
	})

	it('classifies say:"api_req_started" as thinking', () => {
		const messages = [makeSay("api_req_started", "{}")]
		expect(classifyActivity(messages)).toBe("thinking")
	})

	it('classifies say:"api_req_retry_delayed" as retrying', () => {
		const messages = [makeSay("api_req_retry_delayed", "{}")]
		expect(classifyActivity(messages)).toBe("retrying")
	})

	it('classifies say:"api_req_rate_limit_wait" as waiting', () => {
		const messages = [makeSay("api_req_rate_limit_wait", "{}")]
		expect(classifyActivity(messages)).toBe("waiting")
	})

	it('classifies say:"mcp_server_request_started" as usingMcpServer', () => {
		const messages = [makeSay("mcp_server_request_started", "{}")]
		expect(classifyActivity(messages)).toBe("usingMcpServer")
	})

	it('classifies say:"condense_context" as condensingContext', () => {
		const messages = [makeSay("condense_context", "{}")]
		expect(classifyActivity(messages)).toBe("condensingContext")
	})

	it('classifies say:"codebase_search_result" as searching', () => {
		const messages = [makeSay("codebase_search_result", "{}")]
		expect(classifyActivity(messages)).toBe("searching")
	})

	it('classifies say:"command_output" as runningCommand', () => {
		const messages = [makeSay("command_output", "ls output")]
		expect(classifyActivity(messages)).toBe("runningCommand")
	})

	it('classifies say:"text" as activity (generic)', () => {
		const messages = [makeSay("text", "some response")]
		expect(classifyActivity(messages)).toBe("activity")
	})

	// ---- non-semantic noise — skipped ----

	it("skips api_req_finished and continues scanning backward", () => {
		const messages = [makeSay("reasoning", "thinking", 1), makeSay("api_req_finished", "{}", 2)]
		expect(classifyActivity(messages)).toBe("thinking")
	})

	it("skips api_req_retried and continues scanning backward", () => {
		const messages = [makeSay("condense_context", "{}", 1), makeSay("api_req_retried", "{}", 2)]
		expect(classifyActivity(messages)).toBe("condensingContext")
	})

	it("skips api_req_deleted and continues scanning backward", () => {
		const messages = [makeToolSay("readFile", "/src/index.ts", 1), makeSay("api_req_deleted", "{}", 2)]
		expect(classifyActivity(messages)).toBe("reading")
	})

	it("skips rooignore_error and continues scanning backward", () => {
		const messages = [makeSay("command_output", "ls", 1), makeSay("rooignore_error", "{}", 2)]
		expect(classifyActivity(messages)).toBe("runningCommand")
	})

	it("skips multiple noise messages in a row", () => {
		const messages = [
			makeSay("reasoning", "deep thought", 1),
			makeSay("api_req_finished", "{}", 2),
			makeSay("api_req_retried", "{}", 3),
			makeSay("api_req_deleted", "{}", 4),
			makeSay("rooignore_error", "{}", 5),
		]
		expect(classifyActivity(messages)).toBe("thinking")
	})

	// ---- tool say messages ----

	it('classifies say:"tool" with readFile as reading', () => {
		const messages = [makeToolSay("readFile")]
		expect(classifyActivity(messages)).toBe("reading")
	})

	it('classifies say:"tool" with appliedDiff as editing', () => {
		const messages = [makeToolSay("appliedDiff")]
		expect(classifyActivity(messages)).toBe("editing")
	})

	it('classifies say:"tool" with editedExistingFile as editing', () => {
		const messages = [makeToolSay("editedExistingFile")]
		expect(classifyActivity(messages)).toBe("editing")
	})

	it('classifies say:"tool" with newFileCreated as writing', () => {
		const messages = [makeToolSay("newFileCreated")]
		expect(classifyActivity(messages)).toBe("writing")
	})

	it('classifies say:"tool" with searchFiles as searching', () => {
		const messages = [makeToolSay("searchFiles")]
		expect(classifyActivity(messages)).toBe("searching")
	})

	it('classifies say:"tool" with codebaseSearch as searching', () => {
		const messages = [makeToolSay("codebaseSearch")]
		expect(classifyActivity(messages)).toBe("searching")
	})

	it('classifies say:"tool" with listFilesTopLevel as browsing', () => {
		const messages = [makeToolSay("listFilesTopLevel")]
		expect(classifyActivity(messages)).toBe("browsing")
	})

	it('classifies say:"tool" with listFilesRecursive as browsing', () => {
		const messages = [makeToolSay("listFilesRecursive")]
		expect(classifyActivity(messages)).toBe("browsing")
	})

	it('classifies say:"tool" with openTabs as browsing', () => {
		const messages = [makeToolSay("openTabs")]
		expect(classifyActivity(messages)).toBe("browsing")
	})

	it('classifies say:"tool" with generateImage as generatingImage', () => {
		const messages = [makeToolSay("generateImage")]
		expect(classifyActivity(messages)).toBe("generatingImage")
	})

	it('classifies say:"tool" with imageGenerated as generatingImage', () => {
		const messages = [makeToolSay("imageGenerated")]
		expect(classifyActivity(messages)).toBe("generatingImage")
	})

	it('classifies say:"tool" with runSlashCommand as runningCommand', () => {
		const messages = [makeToolSay("runSlashCommand")]
		expect(classifyActivity(messages)).toBe("runningCommand")
	})

	it('classifies say:"tool" with skill as usingSkill', () => {
		const messages = [makeToolSay("skill")]
		expect(classifyActivity(messages)).toBe("usingSkill")
	})

	it('classifies say:"tool" with newTask as delegating', () => {
		const messages = [makeToolSay("newTask")]
		expect(classifyActivity(messages)).toBe("delegating")
	})

	it('classifies say:"tool" with finishTask as finishing', () => {
		const messages = [makeToolSay("finishTask")]
		expect(classifyActivity(messages)).toBe("finishing")
	})

	it('classifies say:"tool" with updateTodoList as updatingTodos', () => {
		const messages = [makeToolSay("updateTodoList")]
		expect(classifyActivity(messages)).toBe("updatingTodos")
	})

	it('classifies say:"tool" with switchMode as usingTool', () => {
		const messages = [makeToolSay("switchMode")]
		expect(classifyActivity(messages)).toBe("usingTool")
	})

	it('classifies say:"tool" with readCommandOutput as usingTool', () => {
		const messages = [makeToolSay("readCommandOutput")]
		expect(classifyActivity(messages)).toBe("usingTool")
	})

	it('classifies say:"tool" with unknown tool as usingTool', () => {
		const messages = [makeToolSay("someUnknownTool")]
		expect(classifyActivity(messages)).toBe("usingTool")
	})

	it('classifies say:"tool" with invalid JSON as usingTool', () => {
		const messages = [makeSay("tool", "not-json")]
		expect(classifyActivity(messages)).toBe("usingTool")
	})

	// ---- ask messages ----

	it('classifies ask:"tool" with readFile as reading', () => {
		const messages = [makeToolAsk("readFile")]
		expect(classifyActivity(messages)).toBe("reading")
	})

	it('classifies ask:"tool" with appliedDiff as editing', () => {
		const messages = [makeToolAsk("appliedDiff")]
		expect(classifyActivity(messages)).toBe("editing")
	})

	it('classifies ask:"tool" with invalid JSON as usingTool', () => {
		const messages = [makeAsk("tool", "not-json")]
		expect(classifyActivity(messages)).toBe("usingTool")
	})

	it('classifies ask:"command_output" as runningCommand', () => {
		const messages = [makeAsk("command_output", "ls")]
		expect(classifyActivity(messages)).toBe("runningCommand")
	})

	it("skips unknown ask types (returns null → keep scanning)", () => {
		const messages = [makeSay("reasoning", "thinking", 1), makeAsk("followup", "what next?", 2)]
		expect(classifyActivity(messages)).toBe("thinking")
	})

	// ---- multi-message scanning ----

	it("scans backward to find the latest meaningful activity", () => {
		const messages = [
			makeSay("reasoning", "planning", 1),
			makeToolSay("readFile", "/a.ts", 2),
			makeToolSay("appliedDiff", "/b.ts", 3),
			makeSay("api_req_finished", "{}", 4),
		]
		// Last non-noise is appliedDiff at index 2 (api_req_finished is skipped)
		expect(classifyActivity(messages)).toBe("editing")
	})

	it("returns activity if all messages are noise", () => {
		const messages = [
			makeSay("api_req_finished", "{}", 1),
			makeSay("api_req_retried", "{}", 2),
			makeSay("api_req_deleted", "{}", 3),
			makeSay("rooignore_error", "{}", 4),
		]
		expect(classifyActivity(messages)).toBe("activity")
	})
})

// ---------------------------------------------------------------------------
// summarizeActivity — forward-scanning aggregation
// ---------------------------------------------------------------------------

describe("summarizeActivity", () => {
	const emptySummary: ActivitySummary = {
		filesRead: 0,
		filesEdited: 0,
		filesCreated: 0,
		searches: 0,
		commands: 0,
		toolUses: 0,
		thinkingSteps: 0,
	}

	it("returns all zeros for empty messages", () => {
		expect(summarizeActivity([])).toEqual(emptySummary)
	})

	it("counts reasoning messages as thinkingSteps", () => {
		const messages = [makeSay("reasoning", "a", 1), makeSay("reasoning", "b", 2)]
		const result = summarizeActivity(messages)
		expect(result.thinkingSteps).toBe(2)
		expect(result.toolUses).toBe(0)
	})

	it("counts api_req_started as thinkingSteps", () => {
		const messages = [makeSay("api_req_started", "{}")]
		expect(summarizeActivity(messages).thinkingSteps).toBe(1)
	})

	it("counts command_output say messages as commands", () => {
		const messages = [makeSay("command_output", "ls -la", 1), makeSay("command_output", "git status", 2)]
		expect(summarizeActivity(messages).commands).toBe(2)
	})

	it("counts command_output ask messages as commands", () => {
		const messages = [makeAsk("command_output", "npm test")]
		expect(summarizeActivity(messages).commands).toBe(1)
	})

	// ---- tool counting ----

	it("counts readFile tool say as filesRead and toolUses", () => {
		const messages = [makeToolSay("readFile")]
		const result = summarizeActivity(messages)
		expect(result.filesRead).toBe(1)
		expect(result.toolUses).toBe(1)
	})

	it("counts appliedDiff tool say as filesEdited and toolUses", () => {
		const messages = [makeToolSay("appliedDiff")]
		const result = summarizeActivity(messages)
		expect(result.filesEdited).toBe(1)
		expect(result.toolUses).toBe(1)
	})

	it("counts editedExistingFile tool say as filesEdited", () => {
		const messages = [makeToolSay("editedExistingFile")]
		expect(summarizeActivity(messages).filesEdited).toBe(1)
	})

	it("counts newFileCreated tool say as filesCreated and toolUses", () => {
		const messages = [makeToolSay("newFileCreated")]
		const result = summarizeActivity(messages)
		expect(result.filesCreated).toBe(1)
		expect(result.toolUses).toBe(1)
	})

	it("counts searchFiles tool say as searches and toolUses", () => {
		const messages = [makeToolSay("searchFiles")]
		const result = summarizeActivity(messages)
		expect(result.searches).toBe(1)
		expect(result.toolUses).toBe(1)
	})

	it("counts openTabs as a tool use but not as a command/search/file counter", () => {
		const messages = [makeToolSay("openTabs")]
		const result = summarizeActivity(messages)
		expect(result.toolUses).toBe(1)
		expect(result.commands).toBe(0)
		expect(result.searches).toBe(0)
		expect(result.filesRead).toBe(0)
		expect(result.filesEdited).toBe(0)
		expect(result.filesCreated).toBe(0)
	})

	it("counts codebaseSearch tool say as searches", () => {
		const messages = [makeToolSay("codebaseSearch")]
		expect(summarizeActivity(messages).searches).toBe(1)
	})

	it("counts runSlashCommand tool say as commands and toolUses", () => {
		const messages = [makeToolSay("runSlashCommand")]
		const result = summarizeActivity(messages)
		expect(result.commands).toBe(1)
		expect(result.toolUses).toBe(1)
	})

	it("counts readCommandOutput tool say as commands", () => {
		const messages = [makeToolSay("readCommandOutput")]
		expect(summarizeActivity(messages).commands).toBe(1)
	})

	// ---- ask tool counting ----

	it("counts readFile tool ask as filesRead and toolUses", () => {
		const messages = [makeToolAsk("readFile")]
		const result = summarizeActivity(messages)
		expect(result.filesRead).toBe(1)
		expect(result.toolUses).toBe(1)
	})

	it("counts appliedDiff tool ask as filesEdited", () => {
		const messages = [makeToolAsk("appliedDiff")]
		expect(summarizeActivity(messages).filesEdited).toBe(1)
	})

	// ---- mixed scenario ----

	it("aggregates a realistic mixed message group", () => {
		const messages = [
			makeSay("reasoning", "planning", 1),
			makeSay("api_req_started", "{}", 2),
			makeToolSay("readFile", "/a.ts", 3),
			makeToolSay("readFile", "/b.ts", 4),
			makeToolSay("searchFiles", "/src", 5),
			makeToolSay("appliedDiff", "/a.ts", 6),
			makeSay("command_output", "npm test", 7),
			makeToolAsk("newFileCreated", "/c.ts", 8),
			makeSay("reasoning", "reflecting", 9),
		]
		const result = summarizeActivity(messages)
		expect(result.thinkingSteps).toBe(3) // 2 reasoning + 1 api_req_started
		expect(result.filesRead).toBe(2)
		expect(result.filesEdited).toBe(1)
		expect(result.filesCreated).toBe(1)
		expect(result.searches).toBe(1)
		expect(result.commands).toBe(1)
		expect(result.toolUses).toBe(5) // readFile×2 + searchFiles + appliedDiff + newFileCreated
	})

	it("does not count noise messages in any counter", () => {
		const messages = [
			makeSay("api_req_finished", "{}", 1),
			makeSay("api_req_retried", "{}", 2),
			makeSay("api_req_deleted", "{}", 3),
			makeSay("rooignore_error", "{}", 4),
		]
		expect(summarizeActivity(messages)).toEqual(emptySummary)
	})

	it("handles unknown tool names (counted in toolUses only)", () => {
		const messages = [makeToolSay("someCustomTool")]
		const result = summarizeActivity(messages)
		expect(result.toolUses).toBe(1)
		expect(result.filesRead).toBe(0)
		expect(result.filesEdited).toBe(0)
		expect(result.filesCreated).toBe(0)
		expect(result.searches).toBe(0)
		expect(result.commands).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// deriveTaskActivityViewModel — view-model derivation
// ---------------------------------------------------------------------------

describe("deriveTaskActivityViewModel", () => {
	it("returns headerMode=active when isActive=true", () => {
		const messages = [makeSay("reasoning", "thinking")]
		const vm = deriveTaskActivityViewModel(messages, true)
		expect(vm.isActive).toBe(true)
		expect(vm.headerMode).toBe("active")
	})

	it("returns headerMode=finished when isActive=false", () => {
		const messages = [makeSay("reasoning", "thinking")]
		const vm = deriveTaskActivityViewModel(messages, false)
		expect(vm.isActive).toBe(false)
		expect(vm.headerMode).toBe("finished")
	})

	it("returns stepCount equal to messages.length", () => {
		const messages = [makeSay("reasoning", "a", 1), makeToolSay("readFile", "/a.ts", 2), makeSay("text", "done", 3)]
		expect(deriveTaskActivityViewModel(messages, true).stepCount).toBe(3)
		expect(deriveTaskActivityViewModel(messages, false).stepCount).toBe(3)
	})

	it("always populates currentStatus regardless of headerMode", () => {
		const messages = [makeToolSay("readFile", "/a.ts")]
		expect(deriveTaskActivityViewModel(messages, true).currentStatus).toBe("reading")
		expect(deriveTaskActivityViewModel(messages, false).currentStatus).toBe("reading")
	})

	it("always populates summary regardless of headerMode", () => {
		const messages = [makeToolSay("readFile", "/a.ts")]
		const activeSummary = deriveTaskActivityViewModel(messages, true).summary
		const finishedSummary = deriveTaskActivityViewModel(messages, false).summary
		expect(activeSummary.filesRead).toBe(1)
		expect(finishedSummary.filesRead).toBe(1)
	})

	it("handles empty messages array gracefully", () => {
		const vm = deriveTaskActivityViewModel([], false)
		expect(vm.isActive).toBe(false)
		expect(vm.headerMode).toBe("finished")
		expect(vm.currentStatus).toBe("activity")
		expect(vm.stepCount).toBe(0)
		expect(vm.summary.thinkingSteps).toBe(0)
	})
})
