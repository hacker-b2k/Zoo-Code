import type OpenAI from "openai"

const DESCRIPTION = `Cancel a background worker by id (main orchestrator only).

Use when evidence from list_workers / get_worker_status shows a worker should stop (failed policy, wrong scope, rate-limited forever, or user asks to cancel).
Do NOT invent worker ids — copy workerId from list_workers.
After cancel, lifecycle becomes cancelled and the worker task is aborted.`

export default {
	type: "function",
	function: {
		name: "cancel_worker",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				worker_id: {
					type: "string",
					description: "Exact workerId from list_workers / get_worker_status.",
				},
				reason: {
					type: ["string", "null"],
					description: "Optional short reason recorded in evidence.",
				},
			},
			required: ["worker_id", "reason"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
