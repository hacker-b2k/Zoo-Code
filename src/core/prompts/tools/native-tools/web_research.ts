import type OpenAI from "openai"

const WEB_RESEARCH_DESCRIPTION = `Use this high-level tool for non-interactive internet research. Provide either a search question or a direct HTTP(S) URL in "input"; routing, fetching, source normalization, and optional top-source reading happen inside the tool. Results preserve source titles, URLs, snippets/content, truncation state, provider, and per-source errors.

Use interactive browser tools instead when the task requires clicking, forms, authentication, dynamic UI state, screenshots, or other browser interaction. Use open_tabs when the user explicitly asks to open a visible browser tab.

The "input" parameter is the primary way to use this tool. If "input" is omitted, the tool auto-infers from "query" (for search) or "url" (for direct URLs). You can provide just "query" or just "url" without "input" — it will work.`

export default {
	type: "function",
	function: {
		name: "web_research",
		description: WEB_RESEARCH_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				input: {
					type: ["string", "null"],
					description: "Search question or direct HTTP(S) URL",
				},
				action: {
					type: ["string", "null"],
					enum: ["search", "read_url", null],
					description: "Action type (auto-inferred from query/url if omitted)",
				},
				query: { type: ["string", "null"], description: "Search query text (used as input if input is omitted)" },
				url: { type: ["string", "null"], description: "Direct URL to read (used as input if input is omitted)" },
				max_results: { type: ["number", "null"], description: "Maximum normalized sources (default 8)" },
				read_top_sources: {
					type: ["number", "null"],
					description: "How many top search results to fetch for full content (default 0)",
				},
			},
			required: [],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
