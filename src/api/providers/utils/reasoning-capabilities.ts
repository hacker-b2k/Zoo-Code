import type { ModelInfo } from "@roo-code/types"

/**
 * Generic, provider-agnostic reasoning-capability inference from a model id.
 *
 * OpenAI-compatible / custom-endpoint handlers have no curated registry lookup, so a
 * profile created with just URL + model + key carries no reasoning capability flags.
 * Infer capabilities from the model-id pattern (capability inference by model shape —
 * the same approach as token-limit inference), so the generic request path can adapt
 * without any provider-name or base-URL hardcoding.
 *
 * Two scopes are provided deliberately:
 *
 * - REQUEST-TIME (`inferRequestTimeReasoningCapabilities`): ONLY `preserveReasoning`.
 *   This is purely additive — it round-trips `reasoning_content` for interleaved
 *   thinking and never removes/alters request parameters, so it cannot regress a
 *   legacy path that already works. It is applied in OpenAiHandler.getModel() so
 *   pre-existing profiles (saved before capability persistence) still benefit.
 *
 * - SAVE-TIME (`inferReasoningCapabilitiesFromModelId`): the full set, including
 *   `supportsReasoningBinary` (extra_body.thinking) and a `supportedParameters`
 *   allow-list that omits `tool_choice`/`parallel_tool_calls`. These DO change the
 *   request shape, so they are persisted into NEW profiles as an explicit saved
 *   choice (manage_provider_profile / Settings defaults), not forced retroactively
 *   onto profiles/models that already work a different way.
 */

/** Ids that already have a dedicated/legacy request path and must NOT be re-shaped by inference. */
const LEGACY_R1_IDS = /deepseek-reasoner/

// Interleaved-thinking families that round-trip reasoning_content across tool calls.
const PRESERVE_REASONING_IDS = /mimo|deepseek-v4|glm-|minimax|kimi-k2|qwen3|reasoner/
// Binary (on/off) thinking-mode families that accept extra_body.thinking.
const BINARY_THINKING_IDS = /mimo|glm-|deepseek-v4/
// Reasoning endpoints that reject/mishandle tool_choice & parallel_tool_calls.
const NO_TOOL_CHOICE_PARALLEL_IDS = /mimo|glm-|deepseek-v4|minimax/

/**
 * Request-time inference. Applies the FULL reasoning capability set for reasoning
 * model families that have no conflicting legacy OpenAiHandler path — for those,
 * this is the correct behaviour their dedicated handlers already use, and it is what
 * lets a pre-existing profile (saved before capability persistence) work completely.
 *
 * The ONLY exclusion is legacy `deepseek-reasoner`: it has a long-standing
 * OpenAiHandler path (R1 without mergeToolResultText, tool_choice/parallel sent) that
 * must not be re-shaped retroactively. Everything else matched here has no such
 * legacy behaviour to regress, so full inference is safe and additive-correct.
 */
export function inferRequestTimeReasoningCapabilities(
	modelId: string,
): Pick<ModelInfo, "preserveReasoning" | "supportsReasoningBinary" | "supportedParameters"> {
	const id = (modelId || "").toLowerCase()
	if (LEGACY_R1_IDS.test(id)) {
		return {}
	}
	return inferReasoningCapabilitiesFromModelId(id)
}

/**
 * Full inference for SAVE-TIME profile defaults. Explicit saved values always win
 * over inference at the call site; nothing here overrides an existing flag.
 */
export function inferReasoningCapabilitiesFromModelId(
	modelId: string,
): Pick<ModelInfo, "preserveReasoning" | "supportsReasoningBinary" | "supportedParameters"> {
	const id = (modelId || "").toLowerCase()
	const out: Pick<ModelInfo, "preserveReasoning" | "supportsReasoningBinary" | "supportedParameters"> = {}

	if (PRESERVE_REASONING_IDS.test(id)) {
		out.preserveReasoning = true
	}
	if (BINARY_THINKING_IDS.test(id)) {
		out.supportsReasoningBinary = true
	}
	if (NO_TOOL_CHOICE_PARALLEL_IDS.test(id)) {
		out.supportedParameters = ["tools", "max_tokens", "temperature", "reasoning", "include_reasoning"]
	}
	return out
}

/**
 * Request-time merge: enrich a resolved ModelInfo with additive reasoning capability
 * inferred from the model id. Only `preserveReasoning` is ever filled, and only when
 * the model info does not already specify it. Explicit values always win.
 */
export function withInferredReasoningCapabilities(modelId: string, info: ModelInfo): ModelInfo {
	const inferred = inferRequestTimeReasoningCapabilities(modelId)
	return {
		...info,
		preserveReasoning: info.preserveReasoning ?? inferred.preserveReasoning,
		supportsReasoningBinary: info.supportsReasoningBinary ?? inferred.supportsReasoningBinary,
		supportedParameters: info.supportedParameters ?? inferred.supportedParameters,
	}
}
