/**
 * Stage 5 — Live Reviewer.
 *
 * Observes the Coder in real time via the ReviewBuffer.
 * Never edits code, never runs shell, never changes files.
 * Only observes and reports findings.
 */

import { ReviewReportSchema } from "../artifacts.js"
import type { StageDefinition } from "../PipelineScheduler.js"

export class StageReviewer {
	static definition(): StageDefinition {
		return {
			id: "reviewer",
			stageName: "Live Reviewer",
			outputSchema: ReviewReportSchema,
		}
	}
}
