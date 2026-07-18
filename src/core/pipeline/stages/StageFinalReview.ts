/**
 * Stage 6 — Final Review (Boss).
 *
 * Makes the final approval decision: approved / needs_fixes / rejected.
 * Inspects codeArtifacts, reviewReport, build/test outcomes.
 * Never modifies code directly.
 */

import { ApprovalReportSchema } from "../artifacts.js"
import type { StageDefinition } from "../PipelineScheduler.js"

export class StageFinalReview {
	static definition(): StageDefinition {
		return {
			id: "final-review",
			stageName: "Final Review",
			outputSchema: ApprovalReportSchema,
		}
	}
}
