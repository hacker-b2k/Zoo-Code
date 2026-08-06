import type OpenAI from "openai"

const DESCRIPTION = `Drain the worker result inbox for the main orchestrator.

Returns completed summaries, failures, provider switches, and cancellations.
Call periodically after spawning workers, or when list_workers shows finished workers.

NEVER use execute_command with sleep/timer when waiting for workers — this blocks the orchestrator and delays result delivery. collect_results returns immediately; if no results yet, do other work or call collect_results again in your next turn.`

export default {
	type: "function",
	function: {
		name: "collect_results",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				unread_only: {
					type: ["boolean", "null"],
					description: "If true (default), only unread results; marks them read. If false, re-export all.",
				},
			},
			required: ["unread_only"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
