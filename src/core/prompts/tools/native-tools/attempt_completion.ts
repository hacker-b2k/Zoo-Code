import type OpenAI from "openai"

const ATTEMPT_COMPLETION_DESCRIPTION = `Use this tool to present the canonical final result after actionable work is complete. Tool results returned by the runtime are sufficient evidence of success or failure; do not wait for a separate user acknowledgment. Verify changed code with appropriate reads, diagnostics, tests, or builds before completing. Do not use this tool for ordinary conversation or explanations that required no action.

CRITICAL: Before calling attempt_completion, if you spawned any workers with spawn_worker, you MUST call list_workers(include_completed=false) to confirm ALL workers are completed or cancelled. If any worker is still running, drain results with collect_results first or cancel workers with cancel_worker. Attempting completion while workers are active will be rejected.

Parameters:
- result: (required) The result of the task. Formulate this result in a way that is final and does not require further input from the user. Don't end your result with questions or offers for further assistance.

Example: Completing after updating CSS
{ "result": "I've updated the CSS to use flexbox layout for better responsiveness" }`

const RESULT_PARAMETER_DESCRIPTION = `Final result message to deliver to the user once the task is complete`

export default {
	type: "function",
	function: {
		name: "attempt_completion",
		description: ATTEMPT_COMPLETION_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				result: {
					type: "string",
					description: RESULT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["result"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
