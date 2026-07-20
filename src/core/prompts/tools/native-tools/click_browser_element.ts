import type OpenAI from "openai"

const DESCRIPTION = `Click an element on a browser page using a CSS selector. Returns the page content after the click.

Use this to click buttons, links, or any interactive element. The selector should be a valid CSS selector like "#submit-btn", "button.login", or "a[href='/about']".`

export default {
	type: "function",
	function: {
		name: "click_browser_element",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "The page ID",
				},
				selector: {
					type: "string",
					description: "CSS selector for the element to click",
				},
			},
			required: ["pageId", "selector"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
