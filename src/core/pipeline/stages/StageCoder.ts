/**
 * Stage 4 — Coder.
 *
 * Implements the approved blueprint. Reads all planning artifacts,
 * writes code artifacts. Publishes structured events to the ReviewBuffer.
 * Never makes architecture decisions.
 */

import { CodeArtifactsSchema } from "../artifacts.js"
import type { StageDefinition } from "../PipelineScheduler.js"

export class StageCoder {
	static definition(): StageDefinition {
		return {
			id: "coder",
			stageName: "Coder",
			outputSchema: CodeArtifactsSchema,
		}
	}
}
