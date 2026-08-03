export type TurnKind = "conversational" | "actionable" | "ambiguous"

export type TurnActionCategory = "read" | "edit" | "create" | "delete" | "execute" | "search" | "spec"

export interface TurnPolicyEvidence {
	signal: string
	reason: string
	weight: number
}

export interface TurnPolicyAction {
	category: TurnActionCategory
	summary: string
	expectedTools: string[]
	matchedVerb: string
}

export interface TurnPolicyDecision {
	kind: TurnKind
	confidence: number
	evidence: TurnPolicyEvidence[]
	action?: TurnPolicyAction
	requiresToolRecovery: boolean
}

interface Rule {
	category: TurnActionCategory
	verbs: string[]
	expectedTools: string[]
	summary: string
}

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

const GREETING = /^(hi|hello|hey|hiya|howdy|good (morning|afternoon|evening))[!.\s]*$/i

const RULES: Rule[] = [
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
		expectedTools: ["write_spec", "read_spec", "list_specs"],
		summary: "create or update a planning/specification document",
	},
	{
		category: "delete",
		verbs: ["delete", "remove", "erase", "get rid of", "drop the", "uninstall", "clean up"],
		expectedTools: ["execute_command", "apply_diff", "write_to_file"],
		summary: "delete or remove something",
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
		expectedTools: ["write_to_file", "apply_diff", "execute_command"],
		summary: "create something new",
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
		expectedTools: ["apply_diff", "write_to_file", "read_file"],
		summary: "modify existing code or files",
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
		expectedTools: ["execute_command"],
		summary: "run a command",
	},
	{
		category: "search",
		verbs: ["find", "search", "look for", "locate", "grep", "where is", "list all"],
		expectedTools: ["search_files", "list_files", "codebase_search"],
		summary: "search the workspace",
	},
	{
		category: "read",
		verbs: ["read", "open", "show me the", "look at", "inspect", "review", "check the", "analyze"],
		expectedTools: ["read_file", "search_files", "list_files"],
		summary: "read or inspect files",
	},
]

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

function clean(text: string): string {
	return text
		.replace(/<environment_details>[\s\S]*?<\/environment_details>/g, " ")
		.replace(/<feedback>[\s\S]*?<\/feedback>/g, " ")
		.replace(/<selection_context>[\s\S]*?<\/selection_context>/g, " ")
		.replace(/\[[a-z_]+\] Result:/gi, " ")
		.replace(/```[\s\S]*?```/g, " ")
		.trim()
}

export function decideTurnPolicy(userContent: unknown): TurnPolicyDecision {
	const text = clean(extractText(userContent))
	if (!text) {
		return { kind: "ambiguous", confidence: 0, evidence: [], requiresToolRecovery: false }
	}

	const normalized = text.toLowerCase()
	if (GREETING.test(text) || CONVERSATIONAL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
		return {
			kind: "conversational",
			confidence: 0.98,
			evidence: [
				{ signal: text.split(/\s+/)[0].toLowerCase(), reason: "greeting or explanation cue", weight: 1 },
			],
			requiresToolRecovery: false,
		}
	}

	for (const rule of RULES) {
		const verb = rule.verbs.find((candidate) => normalized.includes(candidate))
		if (verb) {
			return {
				kind: "actionable",
				confidence: 0.9,
				evidence: [{ signal: verb.trim(), reason: `matched ${rule.category} action`, weight: 0.9 }],
				action: {
					category: rule.category,
					summary: rule.summary,
					expectedTools: rule.expectedTools,
					matchedVerb: verb.trim(),
				},
				requiresToolRecovery: true,
			}
		}
	}

	return {
		kind: "ambiguous",
		confidence: 0.35,
		evidence: [{ signal: "no-clear-action", reason: "no confident conversational or action signal", weight: 0.35 }],
		requiresToolRecovery: false,
	}
}
