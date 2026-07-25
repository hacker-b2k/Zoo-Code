/**
 * Detects whether a user's request requires an actual tool action, and which
 * category of tool is expected.
 *
 * Motivation: when a model replies with text/reasoning but calls no tool, the
 * recovery prompt used to be a single context-free sentence. Re-prompting a
 * model that has *already* misjudged the turn, with no new information, is what
 * lets a task stall until the mistake limit is hit. This module supplies the
 * missing context so the retry can name the detected intent and the expected
 * tool category.
 *
 * Deliberately conservative: this only *adds* guidance to a retry that the
 * agent loop has already decided to send. It never forces a tool call, and a
 * request classified as conversational yields no intent at all, so ordinary
 * questions and explanations keep the original generic wording.
 *
 * Pure string analysis — no I/O, no model call, no dependencies. It runs on an
 * error path that is already latency-sensitive.
 */

export type ActionCategory = "read" | "edit" | "create" | "delete" | "execute" | "search" | "spec"

export interface ActionIntent {
	/** The category of action the user's request implies. */
	category: ActionCategory
	/** Human-readable summary of what the user appears to want done. */
	summary: string
	/** Tool names appropriate for this category, most likely first. */
	expectedTools: string[]
	/** The verb that triggered the classification, for explainability. */
	matchedVerb: string
}

/**
 * Signals that a turn is a question or a request for explanation rather than a
 * request to change something. Checked first: "explain how to delete the cache"
 * is a question, not a deletion request.
 */
const CONVERSATIONAL_PREFIXES = [
	"what is",
	"what are",
	"what does",
	"what do",
	"why is",
	"why are",
	"why does",
	"why do",
	"how does",
	"how do",
	"how would",
	"how can",
	"when should",
	"which is",
	"who is",
	"can you explain",
	"could you explain",
	"please explain",
	"explain",
	"describe",
	"tell me about",
	"what's the difference",
	"is it possible",
	"should i",
	"do you think",
	"any thoughts",
	"thoughts on",
]

/**
 * Verb families mapped to the tools that satisfy them. Ordered by specificity:
 * earlier entries win, so "delete" is not swallowed by a looser "edit" match.
 */
const CATEGORY_RULES: Array<{
	category: ActionCategory
	verbs: string[]
	tools: string[]
	describe: string
}> = [
	{
		category: "spec",
		verbs: [
			"write a spec",
			"write spec",
			"update the spec",
			"update spec",
			"create a spec",
			"create spec",
			"requirements doc",
			"design doc",
			"implementation plan",
			"spec workspace",
		],
		tools: ["write_spec", "read_spec", "list_specs"],
		describe: "create or update a planning/specification document",
	},
	{
		category: "delete",
		verbs: ["delete", "remove", "erase", "get rid of", "drop the", "uninstall", "clean up"],
		tools: ["execute_command", "apply_diff", "write_to_file"],
		describe: "delete or remove something",
	},
	{
		category: "create",
		verbs: [
			"create",
			"add a",
			"add an",
			"add the",
			"make a",
			"make an",
			"new file",
			"scaffold",
			"generate",
			"set up",
			"initialize",
		],
		tools: ["write_to_file", "apply_diff", "execute_command"],
		describe: "create something new",
	},
	{
		category: "edit",
		verbs: [
			"edit",
			"change",
			"modify",
			"update",
			"fix",
			"refactor",
			"rename",
			"replace",
			"implement",
			"improve",
			"migrate",
			"convert",
			"rewrite",
			"apply",
		],
		tools: ["apply_diff", "write_to_file", "read_file"],
		describe: "modify existing code or files",
	},
	{
		category: "execute",
		verbs: [
			"run",
			"execute",
			"build",
			"compile",
			"install",
			"start",
			"launch",
			"test the",
			"npm ",
			"pnpm ",
			"git ",
		],
		tools: ["execute_command"],
		describe: "run a command",
	},
	{
		category: "search",
		verbs: ["find", "search", "look for", "locate", "grep", "where is", "list all"],
		tools: ["search_files", "list_files", "codebase_search"],
		describe: "search the workspace",
	},
	{
		category: "read",
		verbs: ["read", "open", "show me the", "look at", "inspect", "review", "check the", "analyze"],
		tools: ["read_file", "search_files", "list_files"],
		describe: "read or inspect files",
	},
]

/** Extracts plain text from a user content payload of unknown shape. */
function extractText(content: unknown): string {
	if (typeof content === "string") return content

	if (Array.isArray(content)) {
		return content
			.map((block) => {
				if (typeof block === "string") return block
				if (block && typeof block === "object" && "text" in block) {
					const value = (block as { text?: unknown }).text
					return typeof value === "string" ? value : ""
				}
				return ""
			})
			.join("\n")
	}

	if (content && typeof content === "object" && "text" in content) {
		const value = (content as { text?: unknown }).text
		return typeof value === "string" ? value : ""
	}

	return ""
}

/**
 * Environment details and tool results are appended to user turns by the agent
 * loop. They are full of incidental verbs ("modified", "run") that would
 * otherwise dominate the classification, so they are excluded.
 */
function stripMachineGeneratedSections(text: string): string {
	return text
		.replace(/<environment_details>[\s\S]*?<\/environment_details>/g, " ")
		.replace(/<feedback>[\s\S]*?<\/feedback>/g, " ")
		.replace(/<selection_context>[\s\S]*?<\/selection_context>/g, " ")
		.replace(/\[[a-z_]+\] Result:/gi, " ")
		.replace(/```[\s\S]*?```/g, " ")
}

function isConversational(text: string): boolean {
	const trimmed = text.trimStart().toLowerCase()
	return CONVERSATIONAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

/**
 * Classifies a user request. Returns `undefined` when the turn does not clearly
 * call for an action — callers must treat that as "do not add pressure".
 */
export function detectActionIntent(userContent: unknown): ActionIntent | undefined {
	const raw = extractText(userContent)
	if (!raw.trim()) return undefined

	const cleaned = stripMachineGeneratedSections(raw)
	if (!cleaned.trim()) return undefined

	// A leading question/explanation cue means the user wants an answer, not an
	// edit. Requirement: never force tools for normal questions.
	if (isConversational(cleaned)) return undefined

	const haystack = cleaned.toLowerCase()

	for (const rule of CATEGORY_RULES) {
		for (const verb of rule.verbs) {
			if (haystack.includes(verb)) {
				return {
					category: rule.category,
					summary: rule.describe,
					expectedTools: rule.tools,
					matchedVerb: verb.trim(),
				}
			}
		}
	}

	return undefined
}
