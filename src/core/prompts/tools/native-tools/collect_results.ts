import type OpenAI from "openai"

const DESCRIPTION = `Drain the worker result inbox for the main orchestrator.

Returns completed summaries, failures, provider switches, and cancellations.
Call periodically after spawning workers, or when list_workers shows finished workers.`

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
