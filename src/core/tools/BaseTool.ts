import type { ToolName } from "@roo-code/types"

import { Task } from "../task/Task"
import type { ToolUse, HandleError, PushToolResult, AskApproval, NativeToolArgs } from "../../shared/tools"
import { runToolCallGuard } from "./ToolCallGuard"

/**
 * Callbacks passed to tool execution
 */
export interface ToolCallbacks {
	askApproval: AskApproval
	handleError: HandleError
	pushToolResult: PushToolResult
	toolCallId?: string
}

/**
 * Helper type to extract the parameter type for a tool based on its name.
 * If the tool has native args defined in NativeToolArgs, use those; otherwise fall back to any.
 */
type ToolParams<TName extends ToolName> = TName extends keyof NativeToolArgs ? NativeToolArgs[TName] : any

/**
 * Abstract base class for all tools.
 *
 * Tools receive typed arguments from native tool calling via `ToolUse.nativeArgs`.
 *
 * @template TName - The specific tool name, which determines native arg types
 */
export abstract class BaseTool<TName extends ToolName> {
	/**
	 * The tool's name (must match ToolName type)
	 */
	abstract readonly name: TName

	/**
	 * Track the last seen path during streaming to detect when the path has stabilized.
	 * Used by hasPathStabilized() to prevent displaying truncated paths from partial-json parsing.
	 */
	protected lastSeenPartialPath: string | undefined = undefined

	/**
	 * Execute the tool with typed parameters.
	 *
	 * Receives typed parameters from native tool calling via `ToolUse.nativeArgs`.
	 *
	 * @param params - Typed parameters
	 * @param task - Task instance with state and API access
	 * @param callbacks - Tool execution callbacks (approval, error handling, results)
	 */
	abstract execute(params: ToolParams<TName>, task: Task, callbacks: ToolCallbacks): Promise<void>

	/**
	 * Handle partial (streaming) tool messages.
	 *
	 * Default implementation does nothing. Tools that support streaming
	 * partial messages should override this.
	 *
	 * @param task - Task instance
	 * @param block - Partial ToolUse block
	 */
	async handlePartial(task: Task, block: ToolUse<TName>): Promise<void> {
		// Default: no-op for partial messages
		// Tools can override to show streaming UI updates
	}

	/**
	 * Check if a path parameter has stabilized during streaming.
	 *
	 * During native tool call streaming, the partial-json library may return truncated
	 * string values when chunk boundaries fall mid-value. This method tracks the path
	 * value between consecutive handlePartial() calls and returns true only when the
	 * path has stopped changing (stabilized).
	 *
	 * Usage in handlePartial():
	 * ```typescript
	 * if (!this.hasPathStabilized(block.params.path)) {
	 *     return // Path still changing, wait for it to stabilize
	 * }
	 * // Path is stable, proceed with UI updates
	 * ```
	 *
	 * @param path - The current path value from the partial block
	 * @returns true if path has stabilized (same value seen twice) and is non-empty, false otherwise
	 */
	protected hasPathStabilized(path: string | undefined): boolean {
		const pathHasStabilized = this.lastSeenPartialPath !== undefined && this.lastSeenPartialPath === path
		this.lastSeenPartialPath = path
		return pathHasStabilized && !!path
	}

	/**
	 * Reset the partial state tracking.
	 *
	 * Should be called at the end of execute() (both success and error paths)
	 * to ensure clean state for the next tool invocation.
	 */
	resetPartialState(): void {
		this.lastSeenPartialPath = undefined
	}

	/**
	 * Validate that all required string parameters are present and non-empty.
	 *
	 * Returns the name of the first missing parameter, or null if all are valid.
	 * Handles null, undefined, empty string, and whitespace-only values.
	 *
	 * @param params - The parsed tool parameters
	 * @param required - Map of parameter names to their values
	 * @returns The name of the first missing parameter, or null if all valid
	 */
	protected findMissingRequiredParam(
		params: Record<string, unknown>,
		required: Record<string, unknown>,
	): string | null {
		for (const [name, value] of Object.entries(required)) {
			if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
				return name
			}
		}
		return null
	}

	/**
	 * Whether the pre-execution ToolCallGuard should run for this invocation.
	 *
	 * Subclasses override this to opt out for alternate parameter shapes that
	 * the static registry cannot describe (e.g. the legacy `read_file` batch
	 * format, which uses a `files` array instead of a `path` string).
	 *
	 * @param _params - The parsed tool parameters
	 * @returns true when the guard should run (default)
	 */
	protected shouldRunGuard(_params: ToolParams<TName>): boolean {
		return true
	}

	/**
	 * Main entry point for tool execution.
	 *
	 * Handles the complete flow:
	 * 1. Partial message handling (if partial)
	 * 2. Parameter parsing (nativeArgs only)
	 * 3. Core execution (execute)
	 *
	 * @param task - Task instance
	 * @param block - ToolUse block from assistant message
	 * @param callbacks - Tool execution callbacks
	 */
	async handle(task: Task, block: ToolUse<TName>, callbacks: ToolCallbacks): Promise<void> {
		// Handle partial messages
		if (block.partial) {
			try {
				await this.handlePartial(task, block)
			} catch (error) {
				console.error(`Error in handlePartial:`, error)
				await callbacks.handleError(
					`handling partial ${this.name}`,
					error instanceof Error ? error : new Error(String(error)),
				)
			}
			return
		}

		// Native-only: obtain typed parameters from `nativeArgs`.
		let params: ToolParams<TName>
		try {
			if (block.nativeArgs !== undefined) {
				// Native: typed args provided by NativeToolCallParser.
				params = block.nativeArgs as ToolParams<TName>
			} else {
				// If legacy/XML markup was provided via params, surface a clear error.
				const paramsText = (() => {
					try {
						return JSON.stringify(block.params ?? {})
					} catch {
						return ""
					}
				})()
				if (paramsText.includes("<") && paramsText.includes(">")) {
					throw new Error(
						"XML tool calls are no longer supported. Use native tool calling (nativeArgs) instead.",
					)
				}
				throw new Error("Tool call is missing native arguments (nativeArgs).")
			}
		} catch (error) {
			console.error(`Error parsing parameters:`, error)
			const errorMessage = `Failed to parse ${this.name} parameters: ${error instanceof Error ? error.message : String(error)}`
			await callbacks.handleError(`parsing ${this.name} args`, new Error(errorMessage))
			// Note: handleError already emits a tool_result via formatResponse.toolError in the caller.
			// Do NOT call pushToolResult here to avoid duplicate tool_result payloads.
			return
		}

		// Pre-execution guard: validate required params and path params before
		// the tool runs (and before any approval prompt is shown to the user).
		// Unknown/MCP/custom tools are not in the registry and pass through.
		try {
			const violation = this.shouldRunGuard(params)
				? await runToolCallGuard(this.name, (params ?? {}) as Record<string, unknown>, { cwd: task.cwd })
				: null

			if (violation) {
				task.consecutiveMistakeCount++
				task.recordToolError(this.name)

				if (violation.kind === "missing_param") {
					// Preserve legacy behavior: tools historically surfaced missing
					// params through sayAndCreateMissingParamError.
					const errorMsg = await task.sayAndCreateMissingParamError(this.name, violation.paramName)
					callbacks.pushToolResult(`${violation.prefix}${errorMsg}`)
				} else {
					await task.say("error", violation.message)
					callbacks.pushToolResult(`${violation.prefix}${violation.message}`)
				}

				return
			}
		} catch (error) {
			// A guard failure must never block tool execution.
			console.error(`Error running tool call guard for ${this.name}:`, error)
		}

		// Execute with typed parameters
		await this.execute(params, task, callbacks)
	}
}
