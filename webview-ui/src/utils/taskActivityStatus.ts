/**
 * Task Activity Status — Activity classifier and summary aggregation.
 *
 * Single source of truth for determining what a Task Activity group is
 * currently doing (realtime status) and what it has done (summary stats).
 *
 * The classifier scans messages backward from the end of the group to find
 * the latest meaningful activity, skipping non-semantic noise like
 * reasoning fragments and API lifecycle messages.
 *
 * All functions are pure — they derive output from the ClineMessage array
 * with zero side effects.
 */

import type { ClineMessage, ClineSayTool } from "@roo-code/types"
import { safeJsonParse } from "@roo/core"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * i18n translation key for the current activity status.
 * Each key maps to a localized label like "THINKING", "READING", etc.
 */
export type ActivityStatusKey =
	| "thinking"
	| "reading"
	| "editing"
	| "writing"
	| "searching"
	| "browsing"
	| "runningCommand"
	| "generatingImage"
	| "usingMcpServer"
	| "usingTool"
	| "usingSkill"
	| "delegating"
	| "finishing"
	| "updatingTodos"
	| "condensingContext"
	| "retrying"
	| "waiting"
	| "activity"

/**
 * Aggregated counts of operations performed during a Task Activity group.
 */
export interface ActivitySummary {
	filesRead: number
	filesEdited: number
	filesCreated: number
	searches: number
	commands: number
	toolUses: number
	thinkingSteps: number
}

// ---------------------------------------------------------------------------
// Activity classifier — backward scanning
// ---------------------------------------------------------------------------

/**
 * Classifies the current logical activity by scanning messages backward
 * from the end of the group.
 *
 * Skips non-semantic messages (api_req_finished, api_req_deleted,
 * rooignore_error, reasoning that is just a fragment) to find the actual
 * operation the agent is performing or has just completed.
 *
 * @returns An i18n translation key, never null. "activity" is the fallback.
 */
export function classifyActivity(messages: ClineMessage[]): ActivityStatusKey {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]

		if (msg.type === "say") {
			const status = classifySayMessage(msg)
			if (status !== null) {
				return status
			}
			// null = non-semantic noise, keep scanning
			continue
		}

		if (msg.type === "ask") {
			const status = classifyAskMessage(msg)
			if (status !== null) {
				return status
			}
			continue
		}
	}

	return "activity"
}

/**
 * Classify a say-message. Returns null for non-semantic noise that should
 * be skipped when scanning backward.
 */
function classifySayMessage(msg: ClineMessage): ActivityStatusKey | null {
	switch (msg.say) {
		case "reasoning":
			// Reasoning is semantic — the agent is thinking.
			return "thinking"

		case "tool":
			return classifyToolSay(msg)

		case "command_output":
			return "runningCommand"

		case "api_req_started":
			return "thinking"

		case "api_req_retry_delayed":
			return "retrying"

		case "api_req_rate_limit_wait":
			return "waiting"

		case "mcp_server_request_started":
			return "usingMcpServer"

		case "condense_context":
			return "condensingContext"

		case "codebase_search_result":
			return "searching"

		// Non-semantic noise — skip
		case "api_req_finished":
		case "api_req_retried":
		case "api_req_deleted":
		case "rooignore_error":
			return null

		default:
			// Unknown say type — treat as generic activity
			return "activity"
	}
}

/**
 * Classify an ask-message. Returns null for non-semantic noise.
 */
function classifyAskMessage(msg: ClineMessage): ActivityStatusKey | null {
	switch (msg.ask) {
		case "tool": {
			// Parse the tool name from the ask payload.
			const parsed = safeJsonParse<ClineSayTool>(msg.text)
			if (parsed?.tool) {
				return classifyToolName(parsed.tool)
			}
			return "usingTool"
		}

		case "command_output":
			return "runningCommand"

		default:
			return null
	}
}

/**
 * Classify a say:"tool" message by its embedded tool name.
 */
function classifyToolSay(msg: ClineMessage): ActivityStatusKey {
	const parsed = safeJsonParse<ClineSayTool>(msg.text)
	if (parsed?.tool) {
		return classifyToolName(parsed.tool)
	}
	return "usingTool"
}

/**
 * Map a ClineSayTool.tool name to an ActivityStatusKey.
 */
function classifyToolName(toolName: string): ActivityStatusKey {
	switch (toolName) {
		case "readFile":
			return "reading"

		case "appliedDiff":
		case "editedExistingFile":
			return "editing"

		case "newFileCreated":
			return "writing"

		case "searchFiles":
		case "codebaseSearch":
			return "searching"

		case "listFilesTopLevel":
		case "listFilesRecursive":
		case "openTabs":
		case "webResearch":
			return "browsing"

		case "generateImage":
		case "imageGenerated":
			return "generatingImage"

		case "runSlashCommand":
			return "runningCommand"

		case "skill":
			return "usingSkill"

		case "newTask":
			return "delegating"

		case "finishTask":
			return "finishing"

		case "updateTodoList":
			return "updatingTodos"

		case "switchMode":
		case "readCommandOutput":
		default:
			return "usingTool"
	}
}

// ---------------------------------------------------------------------------
// Activity summary — forward-scanning aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregates operation counts across all messages in a group.
 * Used to render a compact summary when a finished Task Activity is collapsed.
 */
export function summarizeActivity(messages: ClineMessage[]): ActivitySummary {
	const summary: ActivitySummary = {
		filesRead: 0,
		filesEdited: 0,
		filesCreated: 0,
		searches: 0,
		commands: 0,
		toolUses: 0,
		thinkingSteps: 0,
	}

	for (const msg of messages) {
		if (msg.type === "say") {
			if (msg.say === "reasoning") {
				summary.thinkingSteps++
			} else if (msg.say === "tool") {
				summary.toolUses++
				countToolSay(msg, summary)
			} else if (msg.say === "api_req_started") {
				summary.thinkingSteps++
			} else if (msg.say === "command_output") {
				summary.commands++
			}
		} else if (msg.type === "ask") {
			if (msg.ask === "tool") {
				summary.toolUses++
				countToolAsk(msg, summary)
			} else if (msg.ask === "command_output") {
				summary.commands++
			}
		}
	}

	return summary
}

/**
 * Increment summary counters based on a say:"tool" message's tool name.
 */
function countToolSay(msg: ClineMessage, summary: ActivitySummary): void {
	const parsed = safeJsonParse<ClineSayTool>(msg.text)
	if (!parsed?.tool) return
	countToolName(parsed.tool, summary)
}

/**
 * Increment summary counters based on an ask:"tool" message's tool name.
 */
function countToolAsk(msg: ClineMessage, summary: ActivitySummary): void {
	const parsed = safeJsonParse<ClineSayTool>(msg.text)
	if (!parsed?.tool) return
	countToolName(parsed.tool, summary)
}

/**
 * Map a tool name to the appropriate summary counter.
 */
function countToolName(toolName: string, summary: ActivitySummary): void {
	switch (toolName) {
		case "readFile":
			summary.filesRead++
			break
		case "appliedDiff":
		case "editedExistingFile":
			summary.filesEdited++
			break
		case "newFileCreated":
			summary.filesCreated++
			break
		case "searchFiles":
		case "codebaseSearch":
			summary.searches++
			break
		case "runSlashCommand":
		case "readCommandOutput":
			summary.commands++
			break
		case "openTabs":
			break
		// Other tools (listFiles, generateImage, skill, etc.) are counted
		// in toolUses but not given dedicated counters.
	}
}
