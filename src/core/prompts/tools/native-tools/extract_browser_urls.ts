import type OpenAI from "openai"

const DESCRIPTION = `Extract all links/URLs from an open browser page. Returns a list of URLs with their link text.

Use this after reading a page to find specific URLs to navigate to, or to get an overview of all links on a page.

pageId is required but auto-detected if only one browser tab is open — you can omit it in that case.`

export default {
	type: "function",
	function: {
		name: "extract_browser_urls",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "The page ID to extract URLs from",
				},
				sameOriginOnly: {
					type: ["boolean", "null"],
					description: "Only return links from the same domain (default: false)",
				},
				limit: {
					type: ["number", "null"],
					description: "Maximum number of URLs to return (default: 50)",
				},
			},
			required: [],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
