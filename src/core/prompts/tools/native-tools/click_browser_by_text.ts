import type OpenAI from "openai"

const DESCRIPTION = `Click an element on a browser page by its visible text. Finds and clicks the first element matching the given text.

Use this when you know the text of a button/link but not its CSS selector. Tries exact match first, then partial match.`

export default {
	type: "function",
	function: {
		name: "click_browser_by_text",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "The page ID",
				},
				text: {
					type: "string",
					description: "Visible text of the element to click",
				},
			},
			required: ["pageId", "text"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
