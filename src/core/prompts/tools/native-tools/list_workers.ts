import type OpenAI from "openai"

const DESCRIPTION = `List background workers for the current main task with evidence-only live state (lifecycle, activity, healthy heartbeat, tools, rate limits, files).

ZERO-GUESS policy: Only report returned fields. Never invent "stuck" from chat silence — call this tool.
Use get_worker_status for one worker; cancel_worker to stop; collect_results for finished outputs.`

export default {
	type: "function",
	function: {
		name: "list_workers",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				include_completed: {
					type: ["boolean", "null"],
					description: "If true, include completed/failed/cancelled workers. Default false.",
				},
			},
			required: ["include_completed"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
