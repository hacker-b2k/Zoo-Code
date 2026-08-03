export interface ReconcileCandidate {
	text?: string
	partial?: boolean
	turnId?: string | number
}

function normalize(value: string | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim()
}

export function shouldReplaceWithCanonicalCompletion(
	ordinary: ReconcileCandidate | undefined,
	completion: ReconcileCandidate,
): boolean {
	if (!ordinary || ordinary.partial === true) return false
	if (ordinary.turnId !== undefined && completion.turnId !== undefined && ordinary.turnId !== completion.turnId)
		return false
	const before = normalize(ordinary.text)
	const final = normalize(completion.text)
	if (!before || !final) return false
	return before === final || final.startsWith(before) || before.startsWith(final)
}
