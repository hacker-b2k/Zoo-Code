import type { ClineSayTool } from "@roo-code/types"

/** Payload `tool` names from provider_manage write tools (askApproval JSON). */
export const PROVIDER_MANAGE_WRITE_TOOLS = [
	"manageProviderProfile",
	"setProviderSecret",
	"activateProviderProfile",
	"deleteProviderProfile",
	"setModeProvider",
] as const

/** Payload `tool` names from provider_manage / MCP read tools. */
export const SETTINGS_MANAGE_READ_TOOLS = [
	"listProviderProfiles",
	"getProviderProfile",
	"listProviderTypes",
	"listMcpConfig",
	"getMcpServer",
	"refreshMcpServers",
] as const

/** Payload `tool` names from mcp_manage write tools. */
export const MCP_MANAGE_WRITE_TOOLS = ["manageMcpServer", "setMcpSecret", "toggleMcpServer", "deleteMcpServer"] as const

export function isWriteToolAction(tool: ClineSayTool): boolean {
	return ["editedExistingFile", "appliedDiff", "newFileCreated", "generateImage"].includes(tool.tool)
}

export function isReadOnlyToolAction(tool: ClineSayTool): boolean {
	return [
		"readFile",
		"listFiles",
		"listFilesTopLevel",
		"listFilesRecursive",
		"searchFiles",
		"codebaseSearch",
		"runSlashCommand",
	].includes(tool.tool)
}

export function isProviderManageWriteTool(tool: ClineSayTool): boolean {
	return (PROVIDER_MANAGE_WRITE_TOOLS as readonly string[]).includes(tool.tool)
}

export function isSettingsManageReadTool(tool: ClineSayTool): boolean {
	return (SETTINGS_MANAGE_READ_TOOLS as readonly string[]).includes(tool.tool)
}

export function isMcpManageWriteTool(tool: ClineSayTool): boolean {
	return (MCP_MANAGE_WRITE_TOOLS as readonly string[]).includes(tool.tool)
}
