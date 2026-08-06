import stringify from "safe-stable-stringify"
import { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

/**
 * Class for detecting consecutive identical tool calls
 * to prevent the AI from getting stuck in a loop.
 */
export class ToolRepetitionDetector {
	private previousToolCallJson: string | null = null
	private consecutiveIdenticalToolCallCount: number = 0
	private readonly consecutiveIdenticalToolCallLimit: number

	/**
	 * Status-polling tools that are designed to be called repeatedly with the
	 * same arguments (e.g., orchestrator checking worker results). These must
	 * never trigger the repetition detector because polling is their intended
	 * usage pattern, not a loop.
	 */
	private static readonly POLLING_EXEMPT_TOOLS: ReadonlySet<string> = new Set([
		"collect_results",
		"list_workers",
		"get_worker_status",
	])

	/**
	 * Args validation failures are unrecoverable without a payload correction.
	 * Their first presentation is an ActionIntent recovery; the identical replay
	 * must never consume another approval/execution slot. We realize this as
	 * the second identical call becoming a hard stop regardless of the generic
	 * configured repetition limit.
	 */
	public static retryGuardBlockingIdenticalMalformedCalls = true

	/**
	 * Creates a new ToolRepetitionDetector
	 * @param limit The maximum number of identical consecutive tool calls allowed
	 */
	constructor(limit: number = 3) {
		this.consecutiveIdenticalToolCallLimit = limit
	}

	/**
	 * Checks if the current tool call is identical to the previous one
	 * and determines if execution should be allowed
	 *
	 * @param currentToolCallBlock ToolUse object representing the current tool call
	 * @returns Object indicating if execution is allowed and a message to show if not
	 */
	public check(currentToolCallBlock: ToolUse): {
		allowExecution: boolean
		askUser?: {
			messageKey: string
			messageDetail: string
		}
	} {
		// Status-polling tools are exempt from repetition detection — calling
		// them repeatedly with the same arguments is their intended behavior
		// (e.g., orchestrator polling collect_results while workers run).
		if (ToolRepetitionDetector.POLLING_EXEMPT_TOOLS.has(currentToolCallBlock.name)) {
			return { allowExecution: true }
		}

		// Serialize the block to a canonical JSON string for comparison
		const currentToolCallJson = this.serializeToolUse(currentToolCallBlock)

		// Compare with previous tool call
		if (this.previousToolCallJson === currentToolCallJson) {
			this.consecutiveIdenticalToolCallCount++
		} else {
			this.consecutiveIdenticalToolCallCount = 0 // Reset to 0 for a new tool
			this.previousToolCallJson = currentToolCallJson
		}

		const malformedMissingRequiredParam = this.looksLikeMissingRequiredParam(currentToolCallBlock)
		const effectiveLimit = malformedMissingRequiredParam
			? Math.min(this.consecutiveIdenticalToolCallLimit || 1, 1)
			: this.consecutiveIdenticalToolCallLimit

		// Check if limit is reached (0 means unlimited)
		if (effectiveLimit > 0 && this.consecutiveIdenticalToolCallCount >= effectiveLimit) {
			// Reset counters to allow recovery if user guides the AI past this point
			this.consecutiveIdenticalToolCallCount = 0
			this.previousToolCallJson = null

			// Return result indicating execution should not be allowed
			return {
				allowExecution: false,
				askUser: {
					messageKey: "mistake_limit_reached",
					messageDetail: t("tools:toolRepetitionLimitReached", { toolName: currentToolCallBlock.name }),
				},
			}
		}

		// Execution is allowed
		return { allowExecution: true }
	}

	private looksLikeMissingRequiredParam(toolUse: ToolUse): boolean {
		const specRequired = new Map<string, string[]>([
			["apply_diff", ["path", "diff"]],
			["write_to_file", ["path", "content"]],
			["read_file", ["path"]],
			["execute_command", ["command"]],
			["ask_followup_question", ["question", "follow_up"]],
		])
		const required = specRequired.get(toolUse.name)
		if (!required) return false
		const value: Record<string, unknown> = {
			...(toolUse.params as Record<string, unknown>),
			...(toolUse.nativeArgs ?? {}),
		}
		const missing = required.some((param) => {
			const entry = value[param]
			return (
				entry === undefined ||
				entry === null ||
				(typeof entry === "string" && entry.trim() === "") ||
				(Array.isArray(entry) && entry.length === 0)
			)
		})
		return missing
	}

	/**
	 * Serializes a ToolUse object into a canonical JSON string for comparison
	 *
	 * @param toolUse The ToolUse object to serialize
	 * @returns JSON string representation of the tool use with sorted parameter keys
	 */
	private serializeToolUse(toolUse: ToolUse): string {
		const toolObject: Record<string, any> = {
			name: toolUse.name,
			params: toolUse.params,
		}

		// Only include nativeArgs if it has content
		if (toolUse.nativeArgs && Object.keys(toolUse.nativeArgs).length > 0) {
			toolObject.nativeArgs = toolUse.nativeArgs
		}

		return stringify(toolObject)
	}
}
