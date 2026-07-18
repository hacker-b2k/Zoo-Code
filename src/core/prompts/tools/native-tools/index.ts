import type OpenAI from "openai"
import accessMcpResource from "./access_mcp_resource"
import { apply_diff } from "./apply_diff"
import applyPatch from "./apply_patch"
import askFollowupQuestion from "./ask_followup_question"
import attemptCompletion from "./attempt_completion"
import codebaseSearch from "./codebase_search"
import editTool from "./edit"
import executeCommand from "./execute_command"
import generateImage from "./generate_image"
import listFiles from "./list_files"
import newTask from "./new_task"
import spawnWorker from "./spawn_worker"
import listWorkers from "./list_workers"
import collectResults from "./collect_results"
import cancelWorker from "./cancel_worker"
import getWorkerStatus from "./get_worker_status"
import readCommandOutput from "./read_command_output"
import { createReadFileTool, type ReadFileToolOptions } from "./read_file"
import runSlashCommand from "./run_slash_command"
import skill from "./skill"
import searchReplace from "./search_replace"
import edit_file from "./edit_file"
import searchFiles from "./search_files"
import switchMode from "./switch_mode"
import updateTodoList from "./update_todo_list"
import writeToFile from "./write_to_file"
import listProviderProfiles from "./list_provider_profiles"
import getProviderProfile from "./get_provider_profile"
import listProviderTypes from "./list_provider_types"
import manageProviderProfile from "./manage_provider_profile"
import setProviderSecret from "./set_provider_secret"
import activateProviderProfile from "./activate_provider_profile"
import deleteProviderProfile from "./delete_provider_profile"
import setModeProvider from "./set_mode_provider"
import listMcpConfig from "./list_mcp_config"
import getMcpServer from "./get_mcp_server"
import manageMcpServer from "./manage_mcp_server"
import setMcpSecret from "./set_mcp_secret"
import toggleMcpServer from "./toggle_mcp_server"
import deleteMcpServer from "./delete_mcp_server"
import refreshMcpServers from "./refresh_mcp_servers"

export { getMcpServerTools } from "./mcp_server"
export { convertOpenAIToolToAnthropic, convertOpenAIToolsToAnthropic } from "./converters"
export type { ReadFileToolOptions } from "./read_file"

/**
 * Options for customizing the native tools array.
 */
export interface NativeToolsOptions {
	/** Whether the model supports image processing (default: false) */
	supportsImages?: boolean
}

/**
 * Get native tools array, optionally customizing based on settings.
 *
 * @param options - Configuration options for the tools
 * @returns Array of native tool definitions
 */
export function getNativeTools(options: NativeToolsOptions = {}): OpenAI.Chat.ChatCompletionTool[] {
	const { supportsImages = false } = options

	const readFileOptions: ReadFileToolOptions = {
		supportsImages,
	}

	return [
		accessMcpResource,
		apply_diff,
		applyPatch,
		askFollowupQuestion,
		attemptCompletion,
		codebaseSearch,
		executeCommand,
		generateImage,
		listFiles,
		newTask,
		spawnWorker,
		listWorkers,
		collectResults,
		cancelWorker,
		getWorkerStatus,
		readCommandOutput,
		createReadFileTool(readFileOptions),
		runSlashCommand,
		skill,
		searchReplace,
		edit_file,
		editTool,
		searchFiles,
		switchMode,
		updateTodoList,
		writeToFile,
		// Provider tools: manage first so models prioritize one-shot upsert over list/explore
		manageProviderProfile,
		setProviderSecret,
		activateProviderProfile,
		listProviderProfiles,
		getProviderProfile,
		listProviderTypes,
		deleteProviderProfile,
		setModeProvider,
		listMcpConfig,
		getMcpServer,
		manageMcpServer,
		setMcpSecret,
		toggleMcpServer,
		deleteMcpServer,
		refreshMcpServers,
	] satisfies OpenAI.Chat.ChatCompletionTool[]
}

// Backward compatibility: export default tools with line ranges enabled
export const nativeTools = getNativeTools()
