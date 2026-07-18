import type OpenAI from "openai"

const DESCRIPTION = `List all open browser tabs. Returns pageIds, URLs, and titles for each open tab.

Use this to see what tabs are open, or to get a pageId for a specific tab you want to interact with.`

export default {
	type: "function",
	function: {
		name: "list_browser_tabs",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {},
			required: [],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
