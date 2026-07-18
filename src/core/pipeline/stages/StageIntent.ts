/**
 * Stage 1 — User Intent Interpreter.
 *
 * Reads the user's message and produces a structured intent artifact.
 * Never writes code. Never plans. Only understands.
 */

import { IntentArtifactSchema } from "../artifacts.js"
import type { StageDefinition } from "../PipelineScheduler.js"
import type { PipelineContext } from "../types.js"

export class StageIntent {
	static definition(): StageDefinition {
		return {
			id: "intent",
			stageName: "User Intent Interpreter",
			outputSchema: IntentArtifactSchema,
			// The executor is injected at runtime by PipelineController
			// when the ApiHandler is available. Phase 1 used no executor
			// (skeleton output); Phase 2 wires a real LLM call.
		}
	}
}
