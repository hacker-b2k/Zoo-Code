import type OpenAI from "openai"

const DESCRIPTION = `Type text into an input field on a browser page. Use CSS selector to target the input.

Use this to fill forms, search boxes, or any text input. The selector should target an input, textarea, or contenteditable element.`

export default {
	type: "function",
	function: {
		name: "type_browser_text",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "The page ID",
				},
				selector: {
					type: "string",
					description: "CSS selector for the input element",
				},
				text: {
					type: "string",
					description: "Text to type into the element",
				},
			},
			required: ["pageId", "selector", "text"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
