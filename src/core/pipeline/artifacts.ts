/**
 * Zod schemas for every stage-boundary artifact.
 *
 * These schemas are the source of truth for cross-stage contracts.
 * Downstream stages consume only the validated, schema-confirmed
 * JSON produced by upstream stages — never raw natural language.
 */

import { z } from "zod"

/** Stage 1: User Intent Interpreter → intent.json */
export const IntentArtifactSchema = z.object({
	summary: z.string(),
	primaryGoal: z.string(),
	constraints: z.array(z.string()),
	hiddenRequirements: z.array(z.string()),
	risks: z.array(z.string()),
	missingInfo: z.array(z.string()),
	successCriteria: z.array(z.string()),
	confidence: z.number().int().min(0).max(100),
	confidenceRationale: z.string(),
})
export type IntentArtifact = z.infer<typeof IntentArtifactSchema>

/** Stage 2: Master Planner → requirements.json */
export const RequirementsArtifactSchema = z.object({
	objectives: z.array(z.string()),
	scope: z.string(),
	acceptanceCriteria: z.array(z.string()),
	priorityOrder: z.array(z.string()),
	functionalRequirements: z.array(z.string()),
	nonFunctionalRequirements: z.array(z.string()),
	dependencies: z.array(z.string()),
	excludedItems: z.array(z.string()),
	confidence: z.number().int().min(0).max(100),
	confidenceRationale: z.string(),
})
export type RequirementsArtifact = z.infer<typeof RequirementsArtifactSchema>

/** Stage 2: Master Planner → tasklist.json */
export const TaskListArtifactSchema = z.object({
	tasks: z.array(
		z.object({
			id: z.string(),
			description: z.string(),
			owner: z.string(),
			dependsOn: z.array(z.string()),
			estimatedEffort: z.string(),
			validationCriteria: z.array(z.string()),
		}),
	),
})
export type TaskListArtifact = z.infer<typeof TaskListArtifactSchema>

/** Stage 3: Architect → blueprint.json + dependency-graph.json */
export const BlueprintArtifactSchema = z.object({
	systemArchitecture: z.string(),
	componentDiagram: z.string(),
	executionGraph: z.array(
		z.object({
			step: z.string(),
			description: z.string(),
			dependencies: z.array(z.string()),
			output: z.string(),
		}),
	),
	dependencyGraph: z.array(
		z.object({
			component: z.string(),
			dependsOn: z.array(z.string()),
			provides: z.array(z.string()),
		}),
	),
	algorithms: z.array(z.string()),
	taskDecomposition: z.array(
		z.object({
			taskId: z.string(),
			files: z.array(z.string()),
			approach: z.string(),
			edgeCases: z.array(z.string()),
		}),
	),
	riskAnalysis: z.array(
		z.object({
			risk: z.string(),
			likelihood: z.enum(["low", "medium", "high"]),
			impact: z.enum(["low", "medium", "high"]),
			mitigation: z.string(),
		}),
	),
	validationPoints: z.array(z.string()),
	rollbackStrategy: z.string(),
	optimizationOpportunities: z.array(z.string()),
	confidence: z.number().int().min(0).max(100),
	confidenceRationale: z.string(),
})
export type BlueprintArtifact = z.infer<typeof BlueprintArtifactSchema>

/** Stage 4: Coder → code-artifacts.json */
export const CodeArtifactsSchema = z.object({
	filesCreated: z.array(z.string()),
	filesModified: z.array(z.string()),
	implementationSummary: z.string(),
	deviations: z.array(
		z.object({
			from: z.string(),
			to: z.string(),
			reason: z.string(),
		}),
	),
	buildStatus: z
		.object({
			success: z.boolean(),
			output: z.string(),
			errors: z.array(z.string()),
		})
		.optional(),
	completionStatus: z.enum(["complete", "partial", "blocked"]),
	confidence: z.number().int().min(0).max(100),
	confidenceRationale: z.string(),
})
export type CodeArtifacts = z.infer<typeof CodeArtifactsSchema>

/** Stage 5: Live Reviewer → review-report.json */
export const ReviewReportSchema = z.object({
	findings: z.array(
		z.object({
			severity: z.enum(["critical", "warning", "info"]),
			category: z.enum([
				"logic_bug",
				"architecture_violation",
				"performance",
				"security",
				"missing_impl",
				"regression",
			]),
			file: z.string().optional(),
			line: z.number().optional(),
			description: z.string(),
			recommendation: z.string(),
		}),
	),
	overallAssessment: z.enum(["approved", "needs_fixes", "rejected"]),
	summary: z.string(),
	confidence: z.number().int().min(0).max(100),
	confidenceRationale: z.string(),
})
export type ReviewReport = z.infer<typeof ReviewReportSchema>

/** Stage 6: Final Review (Boss) → approval-report.json */
export const ApprovalReportSchema = z.object({
	decision: z.enum(["approved", "needs_fixes", "rejected"]),
	fixRequirements: z
		.array(
			z.object({
				taskId: z.string(),
				description: z.string(),
				priority: z.enum(["critical", "high", "medium"]),
			}),
		)
		.optional(),
	summary: z.string(),
	canComplete: z.boolean(),
	confidence: z.number().int().min(0).max(100),
	confidenceRationale: z.string(),
})
export type ApprovalReport = z.infer<typeof ApprovalReportSchema>

/** Stage 7: Response Simplifier → final-response.json */
export const FinalResponseSchema = z.object({
	responseExplanation: z.string(),
	technicalSummaryRequested: z.boolean(),
	engineeringReportRef: z.string().optional(),
})
export type FinalResponse = z.infer<typeof FinalResponseSchema>
