const DESCRIPTION = `Take a screenshot of an open browser page. Returns the screenshot as an image that you can view and analyze.

Use this to visually verify UI, check layout, inspect rendered output, or confirm that a web app looks correct after making changes. The screenshot is returned as an image in the tool result — you can examine it with your vision capabilities.

Parameters:
- pageId: (required) The page ID from open_browser_page or list_browser_tabs. pageId is auto-detected if only one browser tab is open — you can omit it in that case.
- fullPage: (optional) When true, captures the entire scrollable page. Default is false (viewport only).

Example: { "pageId": "abc123", "fullPage": false }`

export const browser_screenshot = {
	type: "function" as const,
	function: {
		name: "browser_screenshot",
		description: DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "The page ID from open_browser_page or list_browser_tabs",
				},
				fullPage: {
					type: "boolean",
					description: "When true, captures the entire scrollable page. Default is false (viewport only).",
				},
			},
			required: [],
		},
	},
}

export default browser_screenshot
