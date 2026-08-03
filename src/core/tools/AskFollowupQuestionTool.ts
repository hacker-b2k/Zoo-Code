import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import type { ToolUse } from "../../shared/tools"
import { getSuggestionMode } from "@roo-code/types"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface Suggestion {
	text: string
	mode?: unknown
}

interface AskFollowupQuestionParams {
	question: string
	// follow_up is typed as an array, but at runtime the value may arrive as a
	// non-array (object/string/number) due to incremental JSON parsing or
	// provider over-encoding (a JSON-string containing the array). The runtime
	// coercion + validation in execute() normalizes a stringified JSON array
	// into a real array and guards against other non-array shapes.
	follow_up: Suggestion[] | unknown
}

export class AskFollowupQuestionTool extends BaseTool<"ask_followup_question"> {
	readonly name = "ask_followup_question" as const

	async execute(params: AskFollowupQuestionParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { question } = params
		const follow_up: unknown = params.follow_up
		const { handleError, pushToolResult } = callbacks

		const recordMissingParamError = async (paramName: string): Promise<void> => {
			task.consecutiveMistakeCount++
			task.recordToolError("ask_followup_question")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("ask_followup_question", paramName))
		}

		const recordValidationError = async (message: string): Promise<void> => {
			task.consecutiveMistakeCount++
			task.recordToolError("ask_followup_question")
			task.didToolFailInCurrentTurn = true
			await task.say("error", message)
			pushToolResult(formatResponse.toolError(message))
		}

		try {
			if (!question) {
				await recordMissingParamError("question")
				return
			}

			// Truly missing follow_up (null/undefined) -> report as a missing parameter.
			if (follow_up === undefined || follow_up === null) {
				await recordMissingParamError("follow_up")
				return
			}

			// Provider-agnostic follow_up coercion (tool-issues Issue 1 + user.txt bug):
			// Some providers/models that receive strict-mode `["array","null"]` schemas
			// over-encode `follow_up` as a JSON STRING containing the array (e.g.
			// `"[{\"text\":\"Yes\",\"mode\":null}]"`) instead of a native JSON array.
			// The previous behavior rejected this with a "must be an array" error, which
			// forced the model into a retry loop with the exact same (wrong) payload —
			// surfacing as the same tool failing repeatedly mid-session ("Tool not found"
			// in user reports was this downstream loop, not a registry drop).
			//
			// Normalize once here so the tool-bridge never rejects an otherwise-valid
			// suggestion list: decode a stringified JSON array into a real array. Only
			// string values are candidates; non-array objects/numbers still fall through
			// to the precise "must be an array" error below (preserving the existing
			// forward-raw-object behavior covered by the keyed-object regression test).
			let normalizedFollowUp: unknown = follow_up
			if (typeof follow_up === "string") {
				const trimmed = follow_up.trim()
				if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
					try {
						const parsed = JSON.parse(trimmed)
						if (Array.isArray(parsed)) {
							normalizedFollowUp = parsed
						}
					} catch {
						// Not valid JSON — leave as-is so the type error path fires.
					}
				}
			}

			// Present-but-wrong-type follow_up (object/string/number that could not be
			// coerced into an array) -> report a clear type/shape error rather than the
			// misleading "Missing value" message, so the model can correct it instead of
			// looping with the same payload.
			if (!Array.isArray(normalizedFollowUp)) {
				await recordValidationError(
					"The 'follow_up' parameter must be an array of suggestion objects, each shaped like { text: string, mode?: string }. " +
						"Retry with 'follow_up' as a JSON array.",
				)
				return
			}

			// Transform follow_up suggestions to the format expected by task.ask.
			// Normalize defensively: models (and XML/text recovery) may deliver items
			// as plain strings ("Yes") or with non-string text values. The webview
			// renders `answer` directly as a React child — an object here crashes the
			// webview with React error #31.
			const follow_up_json = {
				question,
				suggest: (normalizedFollowUp as Array<Suggestion | string>).map((s) => {
					const rawAnswer: unknown = typeof s === "string" ? s : ((s as Suggestion | undefined)?.text ?? s)
					const answer =
						typeof rawAnswer === "string"
							? rawAnswer
							: rawAnswer === undefined || rawAnswer === null
								? ""
								: (() => {
										try {
											return JSON.stringify(rawAnswer)
										} catch {
											return String(rawAnswer)
										}
									})()
					return { answer, mode: getSuggestionMode(typeof s === "object" && s !== null ? s.mode : undefined) }
				}),
			}

			task.consecutiveMistakeCount = 0
			const { text, images } = await task.ask("followup", JSON.stringify(follow_up_json), false)
			const safeText = text ?? ""
			await task.say("user_feedback", safeText, images)
			pushToolResult(formatResponse.toolResult(`<user_message>\n${safeText}\n</user_message>`, images))
		} catch (error) {
			await handleError("asking question", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"ask_followup_question">): Promise<void> {
		const question: string | undefined = block.nativeArgs?.question ?? block.params.question

		// During partial streaming, only show the question to avoid displaying raw JSON
		// The full JSON with suggestions will be sent when the tool call is complete (!block.partial)
		await task.ask("followup", question ?? "", block.partial).catch(() => {})
	}
}

export const askFollowupQuestionTool = new AskFollowupQuestionTool()
