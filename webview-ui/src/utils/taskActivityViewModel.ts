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
 *     → { isActive, headerMode, currentStatus, statusLabel, summary, stepCount }
 *       → TaskActivityGroup renders
 */

import type { ClineMessage } from "@roo-code/types"
import { safeJsonParse } from "@roo/core"

import {
	classifyActivity,
	formatDeleteSpecProgress,
	summarizeActivity,
	type ActivityStatusKey,
	type ActivitySummary,
} from "./taskActivityStatus"

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
 * - `statusLabel`: optional override label (e.g. "Deleting 2/20 specs") when
 *   progress text is more specific than the i18n status key.
 * - `summary`: aggregated operation counts. Only meaningful when headerMode
 *   is "finished", but always populated for consistency.
 * - `stepCount`: total number of messages in the group.
 */
export interface TaskActivityViewModel {
	isActive: boolean
	headerMode: "active" | "finished"
	currentStatus: ActivityStatusKey
	/** When set, badge shows this text instead of i18n status key. */
	statusLabel?: string
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
	const currentStatus = classifyActivity(messages)
	return {
		isActive,
		headerMode: isActive ? "active" : "finished",
		currentStatus,
		statusLabel: extractStatusLabel(messages, currentStatus),
		summary: summarizeActivity(messages),
		stepCount: messages.length,
	}
}

/** Latest delete_spec progress text when activity is deletingSpec. */
function extractStatusLabel(messages: ClineMessage[], status: ActivityStatusKey): string | undefined {
	if (status !== "deletingSpec") return undefined
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type !== "say" || msg.say !== "tool" || !msg.text) continue
		const parsed = safeJsonParse<{
			tool?: string
			action?: string
			index?: number
			total?: number
		}>(msg.text)
		if (parsed?.tool !== "delete_spec") continue
		const label = formatDeleteSpecProgress(parsed)
		if (label) return label
	}
	return undefined
}
