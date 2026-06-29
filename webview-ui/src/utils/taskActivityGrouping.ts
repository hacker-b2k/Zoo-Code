/**
 * Task Activity Grouping — Classification and Virtuoso item construction.
 *
 * Sits between `groupedMessages` and Virtuoso's `data` prop to wrap consecutive
 * intermediate agent messages into a single collapsible TaskActivityGroup item.
 *
 * Classification uses **semantic boundaries** — only messages that require the user
 * to stop and make a decision (command approval, MCP approval, follow-up questions,
 * retry/resume dialogs, completion) are boundaries. All intermediate execution
 * activity (tool calls, command output, API requests, thinking, file reads, etc.)
 * stays inside the group.
 */

import type { ClineAsk, ClineMessage, ClineSay } from "@roo-code/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Synthetic Virtuoso item representing a group of intermediate
 * agent messages wrapped in a collapsible container.
 */
export interface TaskActivityGroupData {
	/** Discriminator literal for type narrowing */
	type: "task_activity_group"
	/** Timestamp of the first message in the group (used as unique key) */
	ts: number
	/** The intermediate messages contained in this group */
	messages: ClineMessage[]
}

/**
 * Union of all possible Virtuoso data items.
 * Either a standalone ClineMessage or a TaskActivityGroupData wrapper.
 */
export type VirtuosoItem = ClineMessage | TaskActivityGroupData

/**
 * Type guard to check if a VirtuosoItem is a TaskActivityGroupData.
 */
export function isTaskActivityGroup(item: VirtuosoItem): item is TaskActivityGroupData {
	return "type" in item && item.type === "task_activity_group"
}

// ---------------------------------------------------------------------------
// Boundary classification
// ---------------------------------------------------------------------------

/**
 * Ask-types that represent genuine user decision points — the agent has paused
 * and is waiting for the user to make a choice, approve an action, or respond.
 * These MUST be rendered as standalone items (never inside a Task Activity group).
 *
 * Intermediate execution asks (tool, command_output) are intentionally excluded:
 * - `tool`: auto-approved or already-resolved tool actions (readFile, listFiles,
 *   searchFiles, apply_diff, edit, write, etc.) — pure execution activity
 * - `command_output`: reading command output — explicitly a non-blocking ask
 */
const BOUNDARY_ASK_TYPES: ReadonlySet<ClineAsk> = new Set<ClineAsk>([
	"followup",
	"command",
	"completion_result",
	"api_req_failed",
	"resume_task",
	"resume_completed_task",
	"mistake_limit_reached",
	"use_mcp_server",
	"auto_approval_max_req_reached",
])

/**
 * Say-types that should always be rendered as standalone items (never grouped).
 * These represent user-visible content, state changes, completion signals, or
 * messages the user must see immediately.
 *
 * `text` is included because it is the assistant's actual response to the user
 * and must never be hidden inside a collapsed activity group.
 */
const BOUNDARY_SAY_TYPES: ReadonlySet<ClineSay> = new Set<ClineSay>([
	"text",
	"user_feedback",
	"user_feedback_diff",
	"completion_result",
	"checkpoint_saved",
	"too_many_tools_warning",
	"task",
	"image",
	"error",
	"diff_error",
	"subtask_result",
	"condense_context_error",
	"sliding_window_truncation",
	"shell_integration_warning",
])

/**
 * Determines whether a message should be rendered as a standalone boundary item
 * (outside any Task Activity group).
 *
 * A message is a boundary if it represents a true user decision point or
 * important visible content. Intermediate execution activity (tool calls,
 * command output, API requests, thinking, file reads, etc.) is NOT a boundary
 * and will be grouped into a Task Activity block.
 */
export function isBoundaryMessage(msg: ClineMessage): boolean {
	if (msg.type === "ask") {
		// Only asks that require user interaction are boundaries.
		// Intermediate asks (tool, command_output) are groupable.
		return msg.ask !== undefined && BOUNDARY_ASK_TYPES.has(msg.ask)
	}
	// msg.type === "say": specific say-types are boundaries
	return msg.say !== undefined && BOUNDARY_SAY_TYPES.has(msg.say)
}

// ---------------------------------------------------------------------------
// Build Virtuoso items
// ---------------------------------------------------------------------------

/**
 * Transforms `groupedMessages` (array of ClineMessage) into `virtuosoItems`
 * (array of VirtuosoItem) by classifying each message as boundary or
 * intermediate and wrapping consecutive intermediate messages into groups.
 *
 * Algorithm: Forward-scanning with buffering.
 * - Walk left to right through `groupedMessages`
 * - If message is a boundary → flush buffer (≥2 → group, 1 → standalone), then emit boundary
 * - If message is groupable → add to buffer
 * - At end of array → flush remaining buffer
 *
 * O(n) time complexity, single pass through the array.
 */
export function buildVirtuosoItems(groupedMessages: ClineMessage[]): VirtuosoItem[] {
	const result: VirtuosoItem[] = []
	const buffer: ClineMessage[] = []

	const flushBuffer = () => {
		if (buffer.length === 0) {
			return
		}
		if (buffer.length === 1) {
			// Single groupable message → emit as standalone
			result.push(buffer[0])
		} else {
			// ≥2 consecutive groupable messages → wrap in a group
			result.push({
				type: "task_activity_group",
				ts: buffer[0].ts,
				messages: [...buffer],
			})
		}
		buffer.length = 0
	}

	for (let i = 0; i < groupedMessages.length; i++) {
		const msg = groupedMessages[i]
		if (isBoundaryMessage(msg)) {
			// Flush any buffered groupable messages first
			flushBuffer()
			// Emit the boundary message as standalone
			result.push(msg)
		} else {
			// Groupable intermediate message — add to buffer
			buffer.push(msg)
		}
	}

	// Flush any remaining buffered messages at end of array
	flushBuffer()

	return result
}
