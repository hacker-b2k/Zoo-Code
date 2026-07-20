import type OpenAI from "openai"

const DESCRIPTION = `Execute multiple browser actions in sequence without stopping between them. Much faster than calling individual tools one by one.

Actions: click, type, navigate, eval. Each action runs immediately after the previous one.`

export default {
	type: "function",
	function: {
		name: "batch_browser_actions",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "The page ID to act on",
				},
				actions: {
					type: "array",
					items: {
						type: "object",
						properties: {
							type: { type: "string", description: "Action type: click, type, navigate, eval" },
							selector: { type: ["string", "null"], description: "CSS selector (for click/type)" },
							text: { type: ["string", "null"], description: "Text to type (for type)" },
							url: { type: ["string", "null"], description: "URL (for navigate)" },
							script: { type: ["string", "null"], description: "JavaScript (for eval)" },
						},
						required: ["type", "selector", "text", "url", "script"],
						additionalProperties: false,
					},
					description: "Array of actions to execute in order",
				},
			},
			required: ["pageId", "actions"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
