/**
 * Shared detection state for the unified tool-call pipeline (No-Lock edition).
 *
 * Replaces the three bare Task fields:
 * - nativeToolCallsDetected
 * - textOnlyResponseCount
 * - consecutiveNoToolUseCount
 *
 * Critical invariant: text recovery (XML/JSON/prose) must NEVER mark the
 * provider as "native". That was the provider-state corruption bug.
 *
 * No-Lock invariant: shouldSendTools ALWAYS returns true. The providerMode
 * never enters a permanent "text_only" lock. Both native and text parsers
 * remain available at all times — the provider can switch freely between
 * native and text_recovered modes across turns.
 */

export type ProviderMode = "unknown" | "native" | "text_recovered"

export class ToolCallDetectionState {
	/** Provider capability as observed so far. */
	private providerMode: ProviderMode = "unknown"
	/** Consecutive assistant turns with no executable tools (any source). */
	private consecutiveNoToolCount = 0
	/**
	 * Consecutive text-only turns while provider capability is still unknown
	 * (or not proven native). Used to decide when to inject text-mode
	 * instructions. No longer locks into text_only mode.
	 */
	private textOnlyResponseCount = 0
	/** Whether any stage produced tools on the current turn. */
	private toolsThisTurn = false
	/**
	 * Once true, subsequent turns should inject text-mode instructions until
	 * the provider proves native capability.
	 */
	private textModeInjected = false

	// --- Stage reports -------------------------------------------------------

	/** Stage 1 produced at least one native stream tool_call. */
	reportNativeTool(): void {
		this.toolsThisTurn = true
		this.providerMode = "native"
		this.consecutiveNoToolCount = 0
		this.textOnlyResponseCount = 0
		// Native proof supersedes prior text-mode fallback.
		this.textModeInjected = false
	}

	/** Stage 2 recovered tools from XML/JSON text markup. */
	reportTextRecovery(): void {
		this.toolsThisTurn = true
		this.consecutiveNoToolCount = 0
		// Never upgrade to "native" from text recovery — that was the bug.
		if (this.providerMode !== "native") {
			this.providerMode = "text_recovered"
			// Recovery works via text; keep text-mode instructions available.
			this.textModeInjected = true
		}
	}

	/** Stage 3 recovered tools from plain prose + code-block intent. */
	reportProseRecovery(): void {
		// Same provider semantics as text recovery; separate method for clarity
		// and future metrics (prose vs markup).
		this.reportTextRecovery()
	}

	/** No stage produced an executable tool this turn. */
	reportNoTool(): void {
		this.toolsThisTurn = false
		this.consecutiveNoToolCount++
		this.textOnlyResponseCount++

		// First pure-text failure: start injecting text-mode instructions
		// (threshold 1 — was 2 before; that delay was a root cause of the
		// late/false "Model Response Incomplete" UX).
		if (this.providerMode !== "native" && this.textOnlyResponseCount >= 1) {
			this.textModeInjected = true
		}

		// No lock-in: text_only mode removed. Always send native tools.
		// If provider later proves native, reportNativeTool() switches back.
	}

	/**
	 * Call at the start of each assistant turn (before stream processing)
	 * so didToolUse reflects only this turn's outcomes.
	 */
	beginTurn(): void {
		this.toolsThisTurn = false
	}

	// --- Derived queries (replace scattered Task.ts conditionals) ------------

	/**
	 * Whether to attach native tool schemas to the next API request.
	 * Always true — no lock-in. Native schemas are sent even for text-only
	 * providers so that if they upgrade to native support, the system
	 * adapts immediately.
	 */
	get shouldSendTools(): boolean {
		return true // Always send native tools — no lock-in
	}

	/**
	 * Whether to inject formatResponse.textOnlyMode() into the next user turn.
	 * True once we've decided text-mode instructions are needed and the
	 * provider is not proven native.
	 */
	get shouldInjectTextMode(): boolean {
		return this.textModeInjected && this.providerMode !== "native"
	}

	/**
	 * System prompt tool-use section variant.
	 * "text" once we're in text_recovered or text-mode-injected.
	 */
	get systemPromptVariant(): "native" | "text" {
		if (this.providerMode === "native") {
			return "native"
		}
		if (this.providerMode === "text_recovered" || this.textModeInjected) {
			return "text"
		}
		return "native"
	}

	/**
	 * Whether to surface the user-visible MODEL_NO_TOOLS_USED banner.
	 * Suppressed for the first 2 failures (threshold 3) so the user does
	 * not see a scary incomplete error while the dual-parser fallback
	 * engages. First turn uses dual mode (native + text instructions),
	 * giving the system two chances before surfacing an error.
	 */
	get shouldShowNoToolsBanner(): boolean {
		return this.consecutiveNoToolCount >= 3
	}

	/** True when any stage produced tools on the current turn. */
	get didToolUse(): boolean {
		return this.toolsThisTurn
	}

	/** Exposed for noToolsUsed() escalation and tests. */
	get consecutiveNoToolCountValue(): number {
		return this.consecutiveNoToolCount
	}

	/** Exposed for tests and diagnostics. */
	get providerModeValue(): ProviderMode {
		return this.providerMode
	}

	/** Exposed for tests and diagnostics. */
	get textOnlyResponseCountValue(): number {
		return this.textOnlyResponseCount
	}

	/** Reset on abort, resume, or provider/config change. */
	reset(): void {
		this.providerMode = "unknown"
		this.consecutiveNoToolCount = 0
		this.textOnlyResponseCount = 0
		this.toolsThisTurn = false
		this.textModeInjected = false
	}
}
