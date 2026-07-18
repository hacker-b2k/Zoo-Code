/**
 * Stage 3 — System Architect.
 *
 * Consumes intent.json + requirements.json + tasklist.json and produces
 * a complete engineering blueprint. Makes all architectural decisions.
 * Never writes code.
 */

import { BlueprintArtifactSchema } from "../artifacts.js"
import type { StageDefinition } from "../PipelineScheduler.js"

export class StageArchitect {
	static definition(): StageDefinition {
		return {
			id: "architect",
			stageName: "System Architect",
			outputSchema: BlueprintArtifactSchema,
		}
	}
}
