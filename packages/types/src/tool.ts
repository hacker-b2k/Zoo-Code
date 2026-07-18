import { z } from "zod"

/**
 * ToolGroup
 */

export const toolGroups = ["read", "edit", "command", "mcp", "modes", "provider_manage", "mcp_manage"] as const

export const toolGroupsSchema = z.enum(toolGroups)

/**
 * Tool groups that have been removed but may still exist in user config files.
 * Used by schema preprocessing to silently strip these before validation,
 * preventing errors for users with older configs.
 */
export const deprecatedToolGroups: readonly string[] = ["browser"]

export type ToolGroup = z.infer<typeof toolGroupsSchema>

/**
 * ToolName
 */

export const toolNames = [
	"execute_command",
	"read_file",
	"read_command_output",
	"write_to_file",
	"apply_diff",
	"edit",
	"search_and_replace",
	"search_replace",
	"edit_file",
	"apply_patch",
	"search_files",
	"list_files",
	"use_mcp_tool",
	"access_mcp_resource",
	"ask_followup_question",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"spawn_worker",
	"list_workers",
	"collect_results",
	"cancel_worker",
	"get_worker_status",
	"codebase_search",
	"update_todo_list",
	"run_slash_command",
	"skill",
	"generate_image",
	"custom_tool",
	"list_provider_profiles",
	"get_provider_profile",
	"list_provider_types",
	"manage_provider_profile",
	"set_provider_secret",
	"activate_provider_profile",
	"delete_provider_profile",
	"set_mode_provider",
	"list_mcp_config",
	"get_mcp_server",
	"manage_mcp_server",
	"set_mcp_secret",
	"toggle_mcp_server",
	"delete_mcp_server",
	"refresh_mcp_servers",
] as const

export const toolNamesSchema = z.enum(toolNames)

export type ToolName = z.infer<typeof toolNamesSchema>

/**
 * ToolUsage
 */

export const toolUsageSchema = z.record(
	toolNamesSchema,
	z.object({
		attempts: z.number(),
		failures: z.number(),
	}),
)

export type ToolUsage = z.infer<typeof toolUsageSchema>
