/**
 * Stage 7 — Response Simplifier.
 *
 * Converts the full technical result into a short, human-readable summary.
 * No raw JSON dumps. Clear, concise language.
 */

import { FinalResponseSchema } from "../artifacts.js"
import type { StageDefinition } from "../PipelineScheduler.js"

export class StageResponse {
	static definition(): StageDefinition {
		return {
			id: "response",
			stageName: "Response Simplifier",
			outputSchema: FinalResponseSchema,
		}
	}
}
