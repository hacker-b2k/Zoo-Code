/**
 * toolParamRegistry.ts — Authoritative registry of parameter specs for every
 * built-in tool.  Consumed by {@link runToolCallGuard} to validate params
 * before a tool executes.
 *
 * The map is derived from every `sayAndCreateMissingParamError` call site in
 * the codebase.  Do **not** invent extra entries — MCP and custom tools are
 * intentionally absent and pass through the guard untouched.
 */

/**
 * Describes the parameter contract for a single tool.
 */
export interface ToolParamSpec {
	/** Params that must be present and non-empty. Checked in array order. */
	required: string[]
	/** Params that hold a workspace-relative file path needing existence/type validation. */
	pathParams?: string[]
	/** If true, a directory at a pathParam is an error and list_files is suggested. */
	rejectDirectory?: boolean
	/** If true, a non-existent path at a pathParam is an error. */
	requireExists?: boolean
	/** Prefix applied to the guard's pushed tool result (some tools use "Error: "). */
	errorPrefix?: string
}

/**
 * Authoritative map from tool name to its parameter specification.
 *
 * Only tools with known, static parameter contracts appear here.
 * MCP tools (`mcp_*`), custom tools, and any tool not listed here
 * will be treated as passing the guard (the guard returns `null`).
 */
export const TOOL_PARAM_REGISTRY: Record<string, ToolParamSpec> = {
	// ── File-system tools ───────────────────────────────────────────────
	read_file: {
		required: ["path"],
		pathParams: ["path"],
		rejectDirectory: true,
		requireExists: true,
		errorPrefix: "Error: ",
	},
	apply_diff: {
		required: ["path", "diff"],
		pathParams: ["path"],
		rejectDirectory: true,
		requireExists: true,
	},
	apply_patch: {
		required: ["patch"],
	},
	write_to_file: {
		required: ["path", "content"],
		pathParams: ["path"],
		rejectDirectory: true,
		// requireExists is intentionally false — creating new files is valid.
	},
	edit: {
		required: ["file_path", "old_string", "new_string"],
		pathParams: ["file_path"],
		rejectDirectory: true,
		requireExists: true,
	},
	edit_file: {
		required: ["file_path"],
		pathParams: ["file_path"],
		rejectDirectory: true,
	},
	search_replace: {
		required: ["file_path", "old_string", "new_string"],
		pathParams: ["file_path"],
		rejectDirectory: true,
		requireExists: true,
	},
	list_files: {
		required: ["path"],
		// Directories are VALID here — no rejectDirectory.
	},
	search_files: {
		required: ["path", "regex"],
	},
	codebase_search: {
		required: ["query"],
	},

	// ── Command / completion tools ──────────────────────────────────────
	execute_command: {
		required: ["command"],
	},
	generate_image: {
		required: ["prompt", "path"],
	},
	read_command_output: {
		required: ["artifact_id"],
		errorPrefix: "Error: ",
	},
	attempt_completion: {
		required: ["result"],
	},
	ask_followup_question: {
		required: ["question", "follow_up"],
	},

	// ── Mode / task tools ───────────────────────────────────────────────
	switch_mode: {
		required: ["mode_slug"],
	},
	new_task: {
		required: ["mode", "message", "todos"],
	},

	// ── Worker tools ────────────────────────────────────────────────────
	spawn_worker: {
		required: ["name", "message"],
	},
	cancel_worker: {
		required: ["worker_id"],
	},
	get_worker_status: {
		required: ["worker_id"],
	},

	// ── Skill / slash-command tools ─────────────────────────────────────
	skill: {
		required: ["skill"],
	},
	run_slash_command: {
		required: ["command"],
	},

	// ── MCP tools ───────────────────────────────────────────────────────
	use_mcp_tool: {
		required: ["server_name", "tool_name"],
	},
	access_mcp_resource: {
		required: ["server_name", "uri"],
	},
	manage_mcp_server: {
		required: ["name"],
	},
	get_mcp_server: {
		required: ["name"],
	},
	delete_mcp_server: {
		required: ["name"],
	},
	toggle_mcp_server: {
		required: ["name"],
	},
	set_mcp_secret: {
		required: ["name", "key"],
	},

	// ── Provider tools ──────────────────────────────────────────────────
	manage_provider_profile: {
		required: ["name"],
	},
	get_provider_profile: {
		required: ["name"],
	},
	delete_provider_profile: {
		required: ["name"],
	},
	activate_provider_profile: {
		required: ["name"],
	},
	set_provider_secret: {
		required: ["name", "key"],
	},
	set_mode_provider: {
		required: ["mode_slug", "name"],
	},

	// ── Web / browser tools ─────────────────────────────────────────────
	web_research: {
		required: [], // Runtime accepts canonical input or legacy action/query/url.
	},
	open_tabs: {
		required: ["urls"],
	},
	open_browser_page: {
		required: ["url"],
	},
	read_browser_page: {
		required: ["pageId"],
	},
	navigate_browser_page: {
		required: ["pageId", "url"],
	},
	extract_browser_urls: {
		required: [], // pageId optional — auto-detected if only one tab open
	},
	extract_browser_data: {
		required: [], // pageId optional — auto-detected if only one tab open
	},
	click_browser_element: {
		required: ["pageId", "selector"],
	},
	type_browser_text: {
		required: ["pageId", "selector", "text"],
	},
	click_browser_by_text: {
		required: ["pageId", "text"],
	},
	evaluate_browser_js: {
		required: ["pageId", "script"],
	},
	batch_browser_actions: {
		required: ["actions"],
	},
}

/**
 * Lookup a tool's parameter specification.
 *
 * @param toolName - The tool name to look up.
 * @returns The {@link ToolParamSpec} for the tool, or `undefined` if the tool
 *   is not in the registry (e.g. MCP tools, custom tools).
 */
export function getToolParamSpec(toolName: string): ToolParamSpec | undefined {
	return TOOL_PARAM_REGISTRY[toolName]
}
