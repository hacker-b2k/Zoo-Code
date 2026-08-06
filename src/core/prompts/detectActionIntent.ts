import { decideTurnPolicy, type TurnActionCategory } from "../agent-policy/TurnPolicy"

export type ActionCategory = TurnActionCategory

export interface ActionIntent {
	category: ActionCategory
	summary: string
	expectedTools: string[]
	matchedVerb: string
}

/**
 * Compatibility wrapper around the canonical turn policy. Only confidently
 * actionable turns produce an ActionIntent; conversational and ambiguous turns
 * must not trigger no-tool recovery.
 */
export function detectActionIntent(userContent: unknown): ActionIntent | undefined {
	const decision = decideTurnPolicy(userContent)
	if (decision.kind !== "actionable" || !decision.requiresToolRecovery || !decision.action) return undefined
	return decision.action
}
