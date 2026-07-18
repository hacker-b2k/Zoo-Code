import type OpenAI from "openai"

const DESCRIPTION = `Execute JavaScript on a browser page and return the result. Runs in an isolated context to avoid variable conflicts.

Use this for complex page interactions, data extraction, or anything that requires custom logic on the page.`

export default {
	type: "function",
	function: {
		name: "evaluate_browser_js",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "The page ID",
				},
				script: {
					type: "string",
					description: "JavaScript to execute. Must return a value (JSON-serializable).",
				},
			},
			required: ["pageId", "script"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
