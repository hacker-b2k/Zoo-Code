/**
 * Stage 2 — Master Planner (Boss).
 *
 * Consumes only intent.json and produces requirements.json + tasklist.json.
 * Never writes code. Never makes architecture decisions. Only plans.
 */

import { RequirementsArtifactSchema } from "../artifacts.js"
import type { StageDefinition } from "../PipelineScheduler.js"

export class StagePlanner {
	static definition(): StageDefinition {
		return {
			id: "planner",
			stageName: "Master Planner",
			outputSchema: RequirementsArtifactSchema,
		}
	}
}
