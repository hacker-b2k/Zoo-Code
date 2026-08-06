import type OpenAI from "openai"

const OPEN_TABS_DESCRIPTION = `Open one or more URLs in a visible user browser. Use this when the user explicitly asks to open, show, or launch pages. Do not use it as an intermediate step for ordinary search or page reading; use web_research for non-interactive research and the interactive browser tools for clicking, forms, authentication, dynamic UI, or screenshots.

Parameters:
- urls: (required) Array of absolute URLs to open
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
