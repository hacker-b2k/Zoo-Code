import type OpenAI from "openai"

const WEB_RESEARCH_DESCRIPTION = `ALWAYS USE THIS TOOL for any task involving the internet — searching, reading pages, checking URLs, or getting information from websites. This tool replaces slow browser automation and command-line curl/wget.

Two actions:
1. "search" — Search the web and get results as structured text (titles, URLs, snippets). Use for: "search for X", "look up Y", "find Z online", "what is X", "latest news about Y"
2. "read_url" — Fetch a URL and get its full text content. Use for: "read this page", "what does this URL say", "visit this link", "how many links on this page", "what information is on this page"

CRITICAL WORKFLOW — always follow this pattern for web research:
Step 1: search → get relevant URLs and snippets
Step 2: read_url → read the most relevant page to get full content
Step 3: Answer the user's question using the content you read

NEVER use execute_command with curl, wget, or agent-browser when this tool is available. This tool is faster, more reliable, and immune to CAPTCHAs.

Examples:
- "search online for ai latest news" → action: "search", query: "ai latest news"
- "what is on https://example.com" → action: "read_url", url: "https://example.com"
- "visit this link and tell me how many articles" → action: "read_url", url: "https://..."`

export default {
	type: "function",
	function: {
		name: "web_research",
		description: WEB_RESEARCH_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["search", "read_url"],
					description: 'Action to perform: "search" to search the web, "read_url" to read a specific URL',
				},
				query: {
					type: ["string", "null"],
					description: 'Search query (required when action is "search")',
				},
				url: {
					type: ["string", "null"],
					description: 'URL to read (required when action is "read_url")',
				},
				max_results: {
					type: ["number", "null"],
					description:
						"Maximum number of search results to return (default: 8, only used with search action)",
				},
			},
			required: ["action", "query", "url", "max_results"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
