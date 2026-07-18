import type OpenAI from "openai"

const OPEN_TABS_DESCRIPTION = `Open URLs in the user's browser. This is the PRIMARY and PREFERRED tool for ALL browser navigation tasks — including web search, opening websites, reading articles, and checking web content.

IMPORTANT: For web search tasks (e.g., "search online for X", "look up Y", "find Z on the web"), construct a search URL and use this tool directly. Examples:
- "search online for ai latest news" → open_tabs with urls: ["https://www.google.com/search?q=ai+latest+news"]
- "look up weather in Karachi" → open_tabs with urls: ["https://www.google.com/search?q=weather+in+Karachi"]
- "find react docs" → open_tabs with urls: ["https://www.google.com/search?q=react+documentation"]

After opening tabs, use the web_research tool (action="read_url") to read the page content — NOT execute_command or browser automation.

When the user asks to open websites, use this tool. When the user asks to SEARCH or READ content from the web, use web_research instead — it returns the content directly without needing a browser.

Parameters:
- urls: (required) Array of absolute URLs to open. For search, use https://www.google.com/search?q=ENCODED_QUERY
- browser: (optional) Browser preference: auto, chrome, or edge
- reuseExisting: (optional) When true, prefer reusing an existing browser session if possible
- visible: (optional) When true, prefer a visible browser window/session

Example:
{ "urls": ["https://www.google.com/search?q=ai+latest+news"], "browser": "auto", "reuseExisting": true, "visible": true }`

export default {
	type: "function",
	function: {
		name: "open_tabs",
		description: OPEN_TABS_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				urls: {
					type: "array",
					items: {
						type: "string",
						description: "Absolute URL to open in the browser",
					},
					description: "List of absolute URLs to open",
				},
				browser: {
					type: "string",
					enum: ["auto", "chrome", "edge"],
					description: "Browser preference",
				},
				reuseExisting: {
					type: "boolean",
					description: "Prefer reusing an existing browser session if possible",
				},
				visible: {
					type: "boolean",
					description: "Prefer a visible browser window/session",
				},
			},
			required: ["urls"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
