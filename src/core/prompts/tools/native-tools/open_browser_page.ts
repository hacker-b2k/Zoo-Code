import type OpenAI from "openai"

const DESCRIPTION = `Open a URL in a managed browser instance. Returns a pageId and the page content.

This is the FIRST step for any browser task. After opening, use read_page, extract_urls, click_element, etc. to interact with the page.

For search: construct a search URL like https://www.google.com/search?q=YOUR_QUERY
The page content (text summary) is returned automatically — no need for a separate read_page call.`

export default {
	type: "function",
	function: {
		name: "open_browser_page",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description: "URL to open. For search, use https://www.google.com/search?q=QUERY",
				},
			},
			required: ["url"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
