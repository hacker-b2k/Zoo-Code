import type OpenAI from "openai"

const DESCRIPTION = `Read the text content of an open browser page. Returns the page's visible text and structure.

Use this when you need to understand what's on a page after opening it. The pageId comes from open_browser_page or list_browser_tabs.`

export default {
	type: "function",
	function: {
		name: "read_browser_page",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "The page ID from open_browser_page or list_browser_tabs",
				},
			},
			required: ["pageId"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
