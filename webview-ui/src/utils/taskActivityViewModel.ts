/**
 * Task Activity View Model — Derives the data shape that TaskActivityGroup
 * renders, keeping all business logic outside the presentational component.
 *
 * The view-model is computed from:
 *   - `messages`: the ClineMessage[] in the group (already available)
 *   - `isActive`: whether the group is the current active group (from lifecycle)
 *
 * Flow:
 *   messages → classifyActivity() / summarizeActivity() → deriveTaskActivityViewModel()
 *     → { isActive, headerMode, currentStatus, summary, stepCount }
 *       → TaskActivityGroup renders
 */

import type { ClineMessage } from "@roo-code/types"

import { classifyActivity, summarizeActivity, type ActivityStatusKey, type ActivitySummary } from "./taskActivityStatus"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The complete view-model for a TaskActivityGroup header.
 *
 * - `headerMode`: "active" | "finished" — determines which header layout to use
 * - `currentStatus`: i18n translation key for the realtime activity label
 *   (e.g. "thinking", "reading", "editing"). Only meaningful when headerMode
 *   is "active", but always populated for consistency.
 * - `summary`: aggregated operation counts. Only meaningful when headerMode
 *   is "finished", but always populated for consistency.
 * - `stepCount`: total number of messages in the group.
 */
export interface TaskActivityViewModel {
	isActive: boolean
	headerMode: "active" | "finished"
	currentStatus: ActivityStatusKey
	summary: ActivitySummary
	stepCount: number
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Derives the complete view-model for a TaskActivityGroup from its messages
 * and lifecycle state.
 *
 * This is the single entry point that ChatView calls for each group.
 * TaskActivityGroup receives the result and renders — it never calls
 * classifyActivity or summarizeActivity directly.
 */
export function deriveTaskActivityViewModel(messages: ClineMessage[], isActive: boolean): TaskActivityViewModel {
	return {
		isActive,
		headerMode: isActive ? "active" : "finished",
		currentStatus: classifyActivity(messages),
		summary: summarizeActivity(messages),
		stepCount: messages.length,
	}
}
