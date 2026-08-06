/**
 * SmartToolSelector — Dynamic tool delivery based on turn classification.
 *
 * Instead of sending all 50+ tool definitions on every message, this module
 * selects between "core" (always available) and "full" (actionable turns only)
 * tool sets based on the user's intent.
 *
 * SAFETY: Core tools are ALWAYS sent — the model never gets zero tools.
 * Core tools provide file awareness, conversation ability, and basic navigation.
 */

import type OpenAI from "openai"

/**
 * Tool delivery level:
 * - "core": Always sent. Lightweight tools for file awareness + conversation (~8 tools, ~2K tokens)
 * - "full": Actionable turns only. All mode-appropriate tools (~50+ tools, ~15-20K tokens)
 */
export type ToolDeliveryLevel = "core" | "full"

/**
 * Core tool names that are ALWAYS available regardless of turn classification.
 * These provide the model with basic file awareness, conversation ability,
 * and workspace navigation — enough to handle any turn safely.
 */
export const CORE_TOOL_NAMES = new Set([
	// Conversation & file awareness (always needed)
	"ask_followup_question",
	"attempt_completion",
	"list_files",
	"read_file",
	"search_files",
	"update_todo_list",
	"list_specs",
	"read_spec",
	// Worker orchestration (commonly needed even for simple tasks)
	"spawn_worker",
	"collect_results",
	"list_workers",
	"get_worker_status",
	"cancel_worker",
	// File editing & commands (needed for any actionable work)
	"execute_command",
	"write_to_file",
	"apply_diff",
	// Skills & web research (lightweight, commonly needed)
	"skill",
	"web_research",
])

/**
 * Determine the tool delivery level based on turn classification.
 *
 * @param turnClassification - The TurnPolicy decision for this turn
 * @param isActionable - Whether the turn is classified as actionable
 * @returns "core" for conversational/ambiguous turns, "full" for actionable turns
 */
export function selectToolDeliveryLevel(isActionable: boolean): ToolDeliveryLevel {
	return isActionable ? "full" : "core"
}

/**
 * Filter a tools array to only include core tools.
 *
 * @param tools - The full tools array
 * @returns Filtered array containing only core tools
 */
export function filterToCoreTools(
	tools: OpenAI.Chat.ChatCompletionTool[],
): OpenAI.Chat.ChatCompletionTool[] {
	return tools.filter((tool) => {
		const name = (tool as OpenAI.Chat.ChatCompletionFunctionTool).function.name
		return CORE_TOOL_NAMES.has(name)
	})
}
