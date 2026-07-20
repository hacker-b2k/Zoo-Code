import { z } from "zod"

/**
 * HistoryItem
 */

export const historyItemSchema = z.object({
	id: z.string(),
	rootTaskId: z.string().optional(),
	parentTaskId: z.string().optional(),
	number: z.number(),
	ts: z.number(),
	task: z.string(),
	/** Optional user-defined display title. Never overwrites `task`. */
	customTitle: z.string().optional(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
	totalCost: z.number(),
	size: z.number().optional(),
	workspace: z.string().optional(),
	mode: z.string().optional(),
	apiConfigName: z.string().optional(), // Provider profile name for sticky profile feature
	status: z.enum(["active", "completed", "delegated"]).optional(),
	delegatedToId: z.string().optional(), // Last child this parent delegated to
	childIds: z.array(z.string()).optional(), // All children spawned by this task
	awaitingChildId: z.string().optional(), // Child currently awaited (set when delegated)
	completedByChildId: z.string().optional(), // Child that completed and resumed this parent
	completionResultSummary: z.string().optional(), // Summary from completed child
})

export type HistoryItem = z.infer<typeof historyItemSchema>

// ─── Shared title helpers ──────────────────────────────────────────────────────
// These are the single source of truth for display titles and search text.
// Consumed by Webview, CLI, and Extension. Never duplicate this logic.

/**
 * Returns the canonical display title for a history item.
 *
 * Priority:
 *   1. `customTitle` (user-defined, non-empty after trim)
 *   2. `task` (original AI-generated / first-user-message title)
 *
 * Every visible task title in the project MUST use this function.
 * No inline `customTitle ?? task` fallbacks allowed.
 */
export function getTaskDisplayTitle(item: Pick<HistoryItem, "task" | "customTitle">): string {
	return item.customTitle?.trim() || item.task
}

/**
 * Returns the canonical search text for a history item.
 *
 * Combines `customTitle` and `task` so that searches match either field.
 * The custom title is placed first so that its characters are weighted
 * earlier in fuzzy-match scoring.
 *
 * Every searchable title in the project MUST use this function.
 * No inline concatenation of `customTitle + task` allowed.
 */
export function getTaskSearchText(item: Pick<HistoryItem, "task" | "customTitle">): string {
	if (!item.customTitle?.trim()) {
		return item.task
	}
	return `${item.customTitle}\n${item.task}`
}

// ─── Rename validation ─────────────────────────────────────────────────────────

/** Maximum length for a custom task title (characters). */
export const CUSTOM_TITLE_MAX_LENGTH = 200

export interface CustomTitleValidationResult {
	ok: true
	normalized: string
}

export interface CustomTitleValidationError {
	ok: false
	error: string
}

export type CustomTitleValidation = CustomTitleValidationResult | CustomTitleValidationError

/**
 * Validates and normalizes a proposed custom task title.
 *
 * Rules:
 *   - Leading/trailing whitespace is trimmed.
 *   - Empty string after trim is valid (signals "clear custom title").
 *   - Non-empty titles must be ≤ `CUSTOM_TITLE_MAX_LENGTH` characters.
 *   - Non-empty titles must differ from the original `task` (otherwise just clear it).
 *
 * This is the SINGLE rename validator. All rename entry points MUST use it.
 * The Extension remains the authoritative validation layer.
 */
export function validateTaskCustomTitle(proposedTitle: string, originalTask: string): CustomTitleValidation {
	const normalized = proposedTitle.trim()

	if (normalized.length === 0) {
		return { ok: true, normalized: "" }
	}

	if (normalized.length > CUSTOM_TITLE_MAX_LENGTH) {
		return {
			ok: false,
			error: `Title must be ${CUSTOM_TITLE_MAX_LENGTH} characters or fewer (got ${normalized.length})`,
		}
	}

	if (normalized === originalTask.trim()) {
		// Setting the title to the original task is a no-op; normalize to empty
		// so the caller can clear the customTitle field instead.
		return { ok: true, normalized: "" }
	}

	return { ok: true, normalized }
}
