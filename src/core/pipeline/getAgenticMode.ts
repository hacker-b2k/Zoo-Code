/**
 * Minimal helpers to read the Deep Sequential Agentic Mode toggle.
 *
 * Phase 1: read-only helper. Phase 2 will add the matching setter
 * route + ExperimentalSettings UI control.
 */

import type { ClineProvider } from "../webview/ClineProvider"

export type AgenticMode = "classic" | "deepSequential"

/**
 * Reads the current agentic mode from global state via the
 * ClineProvider's public `getValue` API. This keeps the pipeline
 * module decoupled from ContextProxy internals.
 *
 * Defaults to "classic" whenever the value is missing or unknown.
 * This guarantees:
 *   - existing users continue with Classic Orchestration unchanged
 *   - the schema default and the runtime default match
 */
export function getAgenticMode(provider: ClineProvider): AgenticMode {
	try {
		const raw = provider.getValue("agenticMode") as unknown
		if (raw === "deepSequential") {
			return "deepSequential"
		}
	} catch {
		// Provider not initialized or context proxy unavailable:
		// fall through to default.
	}
	return "classic"
}
