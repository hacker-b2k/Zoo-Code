import type { ModeConfig, ToolName } from "@roo-code/types"
import { toolNames as validToolNames } from "@roo-code/types"

import { getModeBySlug, getToolsForMode, type Mode } from "../../shared/modes"
import { TOOL_ALIASES, ALWAYS_AVAILABLE_TOOLS } from "../../shared/tools"

/**
 * Intent-like categories for ranking recovery alternatives when the model
 * requests a tool that is unknown or unavailable for the current mode.
 */
type RecoveryCategory = "read" | "list" | "search" | "edit" | "write" | "execute" | "browser" | "spec" | "other"

/**
 * Token-based category hints. Tool names are snake/camel-case, so word-boundary
 * regexes like /\bread\b/ fail on "read_file" because `_` is a word character in JS.
 * We split on non-alphanumeric separators and match whole tokens instead.
 */
const CATEGORY_HINTS: Array<{ category: RecoveryCategory; tokens: string[]; preferred: string[] }> = [
	{
		category: "spec",
		tokens: ["spec", "requirement", "requirements", "design", "plan"],
		preferred: ["write_spec", "read_spec", "list_specs", "delete_spec"],
	},
	{
		category: "search",
		tokens: ["search", "grep", "find", "locate", "findstr", "rg"],
		preferred: ["search_files", "codebase_search", "list_files", "read_file"],
	},
	{
		category: "list",
		tokens: ["list", "ls", "dir", "tree", "glob", "directory", "directories"],
		preferred: ["list_files", "search_files", "codebase_search", "read_file"],
	},
	{
		category: "read",
		tokens: ["read", "cat", "content", "view", "inspect", "open", "show"],
		preferred: ["read_file", "search_files", "list_files", "codebase_search"],
	},
	{
		category: "edit",
		tokens: ["edit", "patch", "diff", "replace", "apply", "modify", "update"],
		preferred: ["apply_diff", "write_to_file", "search_replace", "edit_file", "apply_patch"],
	},
	{
		category: "write",
		tokens: ["write", "create", "save", "scaffold"],
		preferred: ["write_to_file", "apply_diff"],
	},
	{
		category: "execute",
		tokens: ["run", "exec", "execute", "shell", "terminal", "command", "bash", "powershell", "pwsh", "cmd"],
		preferred: ["execute_command", "read_command_output"],
	},
	{
		category: "browser",
		tokens: ["browser", "web", "url", "page", "tab", "http", "https"],
		preferred: ["web_research", "open_browser_page", "read_browser_page", "open_tabs"],
	},
]

/** Tools that supersede shell for common filesystem inspection tasks. */
const FILE_OP_TOOLS = new Set(["read_file", "list_files", "search_files", "codebase_search"])

const FILE_OP_CATEGORIES = new Set<RecoveryCategory>(["read", "list", "search"])

const MAX_ALTERNATIVES = 12

const DEFAULT_PREFERRED = [
	"read_file",
	"list_files",
	"search_files",
	"apply_diff",
	"write_to_file",
	"execute_command",
] as const

/**
 * Split a tool-like name into comparable tokens (snake, kebab, camel).
 */
export function tokenizeToolName(toolName: string): string[] {
	const normalized = toolName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
	return normalized.split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * Resolve alias → canonical name when known.
 */
export function resolveRequestedToolName(toolName: string): string {
	return TOOL_ALIASES[toolName] ?? toolName
}

/**
 * Tools the model may legally call in this mode (mode groups + always-available).
 * Does not include dynamic MCP tool names.
 */
export function getModeAvailableTools(mode: Mode, customModes?: ModeConfig[]): string[] {
	const modeConfig = getModeBySlug(mode, customModes)
	if (!modeConfig) {
		return Array.from(new Set<string>([...ALWAYS_AVAILABLE_TOOLS, ...(validToolNames as readonly string[])])).sort()
	}

	return getToolsForMode(modeConfig.groups).sort()
}

/**
 * Infer a recovery category from a requested (possibly invalid) tool name.
 */
export function inferRecoveryCategory(toolName: string): RecoveryCategory {
	const resolved = resolveRequestedToolName(toolName)
	const tokens = new Set(tokenizeToolName(resolved))

	for (const hint of CATEGORY_HINTS) {
		if (hint.tokens.some((token) => tokens.has(token))) {
			return hint.category
		}
	}

	// Common shell file utilities that models invent as tool names
	if (tokens.has("get") && (tokens.has("content") || tokens.has("childitem") || tokens.has("child"))) {
		return tokens.has("childitem") || tokens.has("child") ? "list" : "read"
	}

	return "other"
}

/**
 * Rank available tools so the most relevant alternatives appear first.
 */
export function suggestToolAlternatives(
	requestedTool: string,
	availableTools: readonly string[],
	limit = MAX_ALTERNATIVES,
): string[] {
	const requested = resolveRequestedToolName(requestedTool).toLowerCase()
	const requestedTokens = tokenizeToolName(requested)
	const available = Array.from(new Set(availableTools.filter(Boolean)))
	const category = inferRecoveryCategory(requestedTool)
	const preferred =
		CATEGORY_HINTS.find((hint) => hint.category === category)?.preferred ?? ([...DEFAULT_PREFERRED] as string[])

	const scored = available.map((tool) => {
		const lower = tool.toLowerCase()
		const toolTokens = new Set(tokenizeToolName(lower))
		let score = 0

		if (lower === requested) score += 1000
		// Preferred list order is the primary ranking signal for recovery suggestions.
		// Keep this well above fuzzy token bonuses so e.g. grep_code → search_files,
		// not codebase_search (which only shares a loose "code"/"search" token).
		if (preferred.includes(tool)) score += 500 - preferred.indexOf(tool) * 40
		if (lower.includes(requested) || requested.includes(lower)) score += 80

		for (const token of requestedTokens) {
			if (token.length < 3) continue
			// Exact token equality only — avoid "code" matching "codebase".
			if (toolTokens.has(token)) {
				score += 25
			}
		}

		// Mild boost for always-available completion/ask tools so recovery never looks empty
		if (tool === "ask_followup_question" || tool === "attempt_completion") score += 1

		// Demote shell when the request is a file op — keep it off the top of the list
		if (FILE_OP_CATEGORIES.has(category) && tool === "execute_command") {
			score -= 40
		}

		return { tool, score }
	})

	scored.sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool))
	return scored
		.filter((entry) => entry.score > 0 || preferred.includes(entry.tool))
		.slice(0, limit)
		.map((entry) => entry.tool)
}

/**
 * Whether shell fallback would be the wrong recovery for this request.
 */
export function shouldDiscourageShellFallback(requestedTool: string, availableTools: readonly string[]): boolean {
	const hasFileTools = availableTools.some((tool) => FILE_OP_TOOLS.has(tool))
	if (!hasFileTools) return false

	const category = inferRecoveryCategory(requestedTool)
	if (FILE_OP_CATEGORIES.has(category)) {
		return true
	}

	const tokens = new Set(tokenizeToolName(requestedTool))
	const shellFileUtils = ["cat", "type", "ls", "dir", "grep", "findstr", "head", "tail", "less", "more"]
	if (shellFileUtils.some((name) => tokens.has(name))) {
		return true
	}

	if (tokens.has("get") && (tokens.has("content") || tokens.has("childitem") || tokens.has("child"))) {
		return true
	}

	return false
}

export interface UnavailableToolRecoveryOptions {
	toolName: string
	/** "unknown" = not in registry; "mode" = exists but not allowed for mode */
	reason: "unknown" | "mode"
	mode?: Mode
	availableTools?: readonly string[]
	/** Optional short list already ranked; when omitted we compute from availableTools */
	alternatives?: readonly string[]
}

/**
 * Build a clear recovery message for an unavailable/unknown tool selection.
 * Prefer mode-available alternatives; never dump the entire global registry.
 * Explicitly discourage execute_command shell fallback for file ops.
 */
export function formatUnavailableToolRecovery(options: UnavailableToolRecoveryOptions): string {
	const { toolName, reason, mode } = options
	const available = options.availableTools ?? []
	const alternatives =
		options.alternatives && options.alternatives.length > 0
			? [...options.alternatives]
			: suggestToolAlternatives(toolName, available)

	const header = reason === "mode" && mode ? `This tool is unavailable in ${mode} mode.` : `This tool is unavailable.`

	const unknownLine =
		reason === "unknown"
			? `Unknown tool "${toolName}". This tool does not exist in the available tool registry.`
			: `Tool "${toolName}" is not allowed${mode ? ` in ${mode} mode` : ""}.`

	const alternativesLine =
		alternatives.length > 0
			? `Available alternatives are: ${alternatives.join(", ")}.`
			: `No alternative tools are currently available for this mode. Use ask_followup_question if you need guidance.`

	const lines = [
		unknownLine,
		header,
		alternativesLine,
		"Retry now with one of the listed tools using native tool calling. Do not invent tool names.",
	]

	const toolsForShellCheck = available.length > 0 ? available : alternatives
	if (shouldDiscourageShellFallback(toolName, toolsForShellCheck)) {
		const fileAlts = toolsForShellCheck.filter((t) => FILE_OP_TOOLS.has(t))
		const preferred = fileAlts.length > 0 ? fileAlts.join(", ") : "read_file, list_files, search_files"
		lines.push(
			`Do not fall back to execute_command (shell/PowerShell/bash) for reading, listing, or searching files when extension tools exist (${preferred}). Use those tools instead.`,
		)
	}

	// If the requested name is a known alias, hint the canonical name when available
	const aliasTarget = TOOL_ALIASES[toolName]
	if (aliasTarget && available.includes(aliasTarget) && !alternatives.includes(aliasTarget)) {
		lines.push(`Did you mean "${aliasTarget}"?`)
	}

	return lines.join(" ")
}

/**
 * Convenience: full recovery for validateToolUse / presentAssistantMessage.
 */
export function buildToolUnavailableError(
	toolName: string,
	reason: "unknown" | "mode",
	mode: Mode,
	customModes?: ModeConfig[],
): string {
	const availableTools = getModeAvailableTools(mode, customModes)
	return formatUnavailableToolRecovery({
		toolName,
		reason,
		mode,
		availableTools,
	})
}

/**
 * True when the name is a registered static tool, alias, or dynamic MCP tool.
 * Thin re-export surface for selection checks outside validateToolUse.
 */
export function isRegisteredToolName(toolName: string, experiments?: Record<string, boolean>): boolean {
	const resolved = resolveRequestedToolName(toolName)
	if ((validToolNames as readonly string[]).includes(resolved)) return true
	if ((validToolNames as readonly string[]).includes(toolName)) return true
	if (toolName.startsWith("mcp_")) return true
	// custom tools are experiment-gated; callers that care should use isValidToolName
	void experiments
	return false
}

export function listCanonicalToolNames(): readonly ToolName[] {
	return validToolNames
}
