/**
 * Unified tool-call pipeline orchestrator.
 *
 * Stage order (later stages only run when earlier stages produce no tools):
 * 1. Native stream tool_calls (NativeToolCallParser)
 * 2. XML/JSON text recovery (TextToolCallParser via textToolCallRecovery) — Step 1.3
 * 3. Plain-prose file-write intent (TextIntentExtractor) — Step 1.4
 *
 * Detection state lives in ToolCallDetectionState so Task.ts no longer owns
 * bare nativeToolCallsDetected / textOnlyResponseCount counters.
 */

import type { ApiStreamChunk } from "../../api/transform/stream"
import type { ToolName } from "@roo-code/types"
import type { ToolUse, McpToolUse } from "../../shared/tools"
import { NativeToolCallParser, type ToolCallStreamEvent } from "./NativeToolCallParser"
import {
	applyTextualToolCallRecovery,
	hasExecutableNativeToolUse,
	type RecoverableAssistantBlock,
} from "./textToolCallRecovery"
import { ToolCallDetectionState } from "./ToolCallDetectionState"

export type PipelineResult = {
	assistantMessageContent: RecoverableAssistantBlock[]
	assistantMessage: string
	currentStreamingContentIndex: number
	recoveredTextToolCount: number
}

export type PipelineFinalizeInput = {
	assistantMessage: string
	assistantMessageContent: RecoverableAssistantBlock[]
	currentStreamingContentIndex: number
}

/**
 * Events Task must apply to assistantMessageContent during streaming.
 * Stage 1 does not mutate Task's arrays directly — it returns events so
 * Task's existing handleToolCallStart/Delta/End remain the sole mutators
 * of streamingToolCallIndices / handledStreamedToolCallIds.
 */
export type NativeStreamEvents = {
	events: ToolCallStreamEvent[]
	/** True when this chunk indicated native tool activity. */
	sawNativeToolActivity: boolean
}

export class ToolCallPipeline {
	readonly state: ToolCallDetectionState

	/** True if any native tool_call* activity was observed this turn. */
	private nativeActivityThisTurn = false

	constructor(state?: ToolCallDetectionState) {
		this.state = state ?? new ToolCallDetectionState()
	}

	/** Call at the start of each assistant turn before streaming. */
	beginTurn(): void {
		this.nativeActivityThisTurn = false
		this.state.beginTurn()
	}

	/**
	 * Stage 1 — process a stream chunk for native tool_call activity.
	 *
	 * For `tool_call_partial`, returns start/delta/end events from
	 * NativeToolCallParser.processRawChunk (same as Task does today).
	 * For direct start/delta/end and complete tool_call chunks, records
	 * native activity so finalize can reportNativeTool.
	 *
	 * Does NOT run Stages 2–3 (those are post-stream only).
	 */
	processStreamChunk(chunk: ApiStreamChunk): NativeStreamEvents {
		const empty: NativeStreamEvents = { events: [], sawNativeToolActivity: false }

		switch (chunk.type) {
			case "tool_call_partial": {
				const events = NativeToolCallParser.processRawChunk({
					index: chunk.index,
					id: chunk.id,
					name: chunk.name,
					arguments: chunk.arguments,
				})
				if (events.length > 0) {
					this.nativeActivityThisTurn = true
				}
				return { events, sawNativeToolActivity: events.length > 0 }
			}
			case "tool_call_start":
			case "tool_call_delta":
			case "tool_call_end":
			case "tool_call": {
				this.nativeActivityThisTurn = true
				return { events: [], sawNativeToolActivity: true }
			}
			default:
				return empty
		}
	}

	/**
	 * Finalize after the stream ends.
	 *
	 * Stage 1: if executable native tools exist (or native activity was seen),
	 * reportNativeTool. Text recovery still runs as a silent fallback —
	 * applyTextualToolCallRecovery's internal guard skips when native tools
	 * are present, making this a no-op safety net.
	 * Stage 2: XML/JSON text recovery via applyTextualToolCallRecovery.
	 * Stage 3: prose file-write intent (already inside applyTextualToolCallRecovery).
	 * No-tool: if no stage produced tools, reportNoTool.
	 */
	finalize(input: PipelineFinalizeInput): PipelineResult {
		const { assistantMessage, assistantMessageContent, currentStreamingContentIndex } = input

		// Flush any remaining raw partial tool calls (same as Task.finalizeRawChunks).
		const flushEvents = NativeToolCallParser.finalizeRawChunks()
		if (flushEvents.length > 0) {
			this.nativeActivityThisTurn = true
		}

		// Stage 1: native tools detected — report and run silent fallback.
		if (hasExecutableNativeToolUse(assistantMessageContent) || this.nativeActivityThisTurn) {
			if (hasExecutableNativeToolUse(assistantMessageContent)) {
				this.state.reportNativeTool()
			} else if (this.nativeActivityThisTurn) {
				this.state.reportNativeTool()
			}

			// Always run text recovery as silent fallback — even when native
			// tools exist. The recovery function's internal guard
			// (hasExecutableNativeToolUse check) skips when native tools are
			// present, making this a no-op safety net. This catches edge
			// cases where a model emits BOTH native tool_calls AND text-based
			// tool calls in the same response.
			const recovery = applyTextualToolCallRecovery({
				assistantMessage,
				assistantMessageContent,
				currentStreamingContentIndex,
			})

			if (recovery.applied && recovery.recoveredCount > 0) {
				return {
					assistantMessageContent: recovery.assistantMessageContent,
					assistantMessage: recovery.assistantMessage,
					currentStreamingContentIndex: recovery.currentStreamingContentIndex,
					recoveredTextToolCount: recovery.recoveredCount,
				}
			}

			return {
				assistantMessageContent: [...assistantMessageContent],
				assistantMessage,
				currentStreamingContentIndex,
				recoveredTextToolCount: 0,
			}
		}

		// Stages 2+3: text recovery (XML/JSON markup + prose intent).
		// applyTextualToolCallRecovery handles both internally and returns
		// the same shape Task.ts used to consume directly.
		const recovery = applyTextualToolCallRecovery({
			assistantMessage,
			assistantMessageContent,
			currentStreamingContentIndex,
		})

		if (recovery.applied && recovery.recoveredCount > 0) {
			// Text recovery (XML/JSON or prose) succeeded.
			// reportTextRecovery handles both (prose delegates to same logic).
			this.state.reportTextRecovery()

			return {
				assistantMessageContent: recovery.assistantMessageContent,
				assistantMessage: recovery.assistantMessage,
				currentStreamingContentIndex: recovery.currentStreamingContentIndex,
				recoveredTextToolCount: recovery.recoveredCount,
			}
		}

		// No stage produced tools — report and pass content through unchanged.
		this.state.reportNoTool()

		return {
			assistantMessageContent: recovery.applied ? recovery.assistantMessageContent : [...assistantMessageContent],
			assistantMessage: recovery.applied ? recovery.assistantMessage : assistantMessage,
			currentStreamingContentIndex: recovery.applied
				? recovery.currentStreamingContentIndex
				: currentStreamingContentIndex,
			recoveredTextToolCount: 0,
		}
	}

	// --- State queries (delegates) -------------------------------------------

	get shouldSendTools(): boolean {
		return this.state.shouldSendTools
	}

	get shouldInjectTextMode(): boolean {
		return this.state.shouldInjectTextMode
	}

	get systemPromptVariant(): "native" | "text" {
		return this.state.systemPromptVariant
	}

	get didToolUse(): boolean {
		return this.state.didToolUse
	}

	get shouldShowNoToolsBanner(): boolean {
		return this.state.shouldShowNoToolsBanner
	}

	/** Test / diagnostics helper. */
	get sawNativeActivityThisTurn(): boolean {
		return this.nativeActivityThisTurn
	}

	/**
	 * Parse a complete native tool_call chunk into ToolUse (Stage 1 helper).
	 * Thin wrapper around NativeToolCallParser.parseToolCall for callers
	 * that already have a full tool_call chunk.
	 */
	parseCompleteToolCall(toolCall: { id: string; name: string; arguments: string }): ToolUse | McpToolUse | null {
		this.nativeActivityThisTurn = true
		return NativeToolCallParser.parseToolCall({
			id: toolCall.id,
			name: toolCall.name as ToolName,
			arguments: toolCall.arguments,
		})
	}

	/** Reset pipeline + detection state (abort / provider change). */
	reset(): void {
		this.nativeActivityThisTurn = false
		this.state.reset()
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	}
}

// Re-export for convenience when wiring Task
export { ToolCallDetectionState }
export type { RecoverableAssistantBlock }
