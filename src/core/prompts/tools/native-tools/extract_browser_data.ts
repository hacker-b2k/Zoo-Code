import type OpenAI from "openai"

const DESCRIPTION = `Extract structured data (tables, lists, text) from a browser page.

Use this to get organized data from a page — tables as JSON with headers/rows, lists as arrays, or text from specific elements.`

export default {
	type: "function",
	function: {
		name: "extract_browser_data",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "The page ID to extract data from",
				},
				selector: {
					type: ["string", "null"],
					description: "CSS selector for specific element. Omit to auto-detect tables and lists.",
				},
				extractType: {
					type: ["string", "null"],
					description: 'Type: "table", "list", "text", or "auto" (default: auto)',
				},
				maxRows: {
					type: ["number", "null"],
					description: "Maximum rows/items to extract (default: 50)",
				},
			},
			required: ["pageId", "selector", "extractType", "maxRows"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
