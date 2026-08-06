import type OpenAI from "openai"

const DESCRIPTION = `Get evidence-only live status for one background worker (lifecycle + heartbeats, tools, rate limits, files).

ZERO-GUESS: Report only returned fields. Never say stuck/probably/maybe unless healthy===false or lastError is set.
Prefer list_workers for fleet overview; use this for deep inspection of one workerId.`

export default {
	type: "function",
	function: {
		name: "get_worker_status",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				worker_id: {
					type: "string",
					description: "Exact workerId from list_workers.",
				},
			},
			required: ["worker_id"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
