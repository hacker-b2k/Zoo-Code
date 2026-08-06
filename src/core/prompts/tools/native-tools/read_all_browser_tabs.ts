import type OpenAI from "openai"

const DESCRIPTION = `Read the content of ALL open browser tabs at once. Returns pageId, URL, and text content for each tab.

Use this instead of reading tabs one by one. Much faster for multi-tab research.`

export default {
	type: "function",
	function: {
		name: "read_all_browser_tabs",
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
