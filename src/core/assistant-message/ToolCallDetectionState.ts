/**
 * Shared detection state for the unified tool-call pipeline.
 *
 * Replaces the three bare Task fields:
 * - nativeToolCallsDetected
 * - textOnlyResponseCount
 * - consecutiveNoToolUseCount
 *
 * Critical invariant: text recovery (XML/JSON/prose) must NEVER mark the
 * provider as "native". That was the provider-state corruption bug.
 */

export type ProviderMode = "unknown" | "native" | "text_only" | "text_recovered"

export class ToolCallDetectionState {
	/** Provider capability as observed so far. */
	private providerMode: ProviderMode = "unknown"
	/** Consecutive assistant turns with no executable tools (any source). */
	private consecutiveNoToolCount = 0
	/**
	 * Consecutive text-only turns while provider capability is still unknown
	 * (or not proven native). Used to decide when to enter text_only mode.
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

		// Second consecutive pure-text failure while not proven native:
		// lock into text_only (drop native tool schemas on subsequent API calls).
		if (this.providerMode !== "native" && this.textOnlyResponseCount >= 2) {
			this.providerMode = "text_only"
		}
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
	 * Only false when locked into text_only (schemas waste tokens / confuse
	 * text-only gateways).
	 */
	get shouldSendTools(): boolean {
		return this.providerMode !== "text_only"
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
	 * "text" once we're in text_only / text_recovered / text-mode-injected.
	 */
	get systemPromptVariant(): "native" | "text" {
		if (this.providerMode === "native") {
			return "native"
		}
		if (this.providerMode === "text_only" || this.providerMode === "text_recovered" || this.textModeInjected) {
			return "text"
		}
		return "native"
	}

	/**
	 * Whether to surface the user-visible MODEL_NO_TOOLS_USED banner.
	 * Suppressed on the first failure (transition into text-mode inject) so
	 * the user does not see a scary incomplete error while fallback engages.
	 * Shown from the second consecutive no-tool turn onward (matches prior
	 * consecutiveNoToolUseCount >= 2 behavior once fallback is active).
	 */
	get shouldShowNoToolsBanner(): boolean {
		return this.consecutiveNoToolCount >= 2
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
