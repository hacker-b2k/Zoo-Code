import type OpenAI from "openai"

const DESCRIPTION = `Navigate an open browser page to a new URL. Returns the new page content automatically.

Use this to move between pages. The page content is returned in the result — no need for a separate read_browser_page call.`

export default {
	type: "function",
	function: {
		name: "navigate_browser_page",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "The page ID to navigate",
				},
				url: {
					type: "string",
					description: "URL to navigate to",
				},
			},
			required: ["pageId", "url"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
