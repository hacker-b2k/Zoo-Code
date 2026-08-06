import type { SkillMetadata } from "../../shared/skills"

export interface SkillRouteCandidate {
	skill: SkillMetadata
	score: number
	reasons: string[]
}

export interface SkillRouteResult {
	query: string
	candidates: SkillRouteCandidate[]
	explicit: boolean
}

export interface SkillRouteOptions {
	maxCandidates?: number
	minimumScore?: number
}

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"for",
	"from",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"the",
	"this",
	"to",
	"use",
	"when",
	"with",
])

function tokens(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
	)
}

function normalizeQuery(query: unknown): string {
	if (typeof query === "string") return query.trim()
	if (Array.isArray(query)) {
		return query
			.map((block) =>
				block && typeof block === "object" && "text" in block && typeof block.text === "string"
					? block.text
					: "",
			)
			.join(" ")
			.trim()
	}
	return ""
}

function explicitSkillName(query: string, skillName: string): boolean {
	const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	return new RegExp(`(?:^|\\s|[/'\"])(?:skill[:\\s]+)?${escaped}(?=$|\\s|[.,!?'\"/])`, "i").test(query)
}

export function routeSkills(
	queryInput: unknown,
	skills: SkillMetadata[],
	options: SkillRouteOptions = {},
): SkillRouteResult {
	const query = normalizeQuery(queryInput)
	if (!query) return { query, candidates: [], explicit: false }

	const maxCandidates = options.maxCandidates ?? 3
	const minimumScore = options.minimumScore ?? 0.42
	const queryTokens = tokens(query)
	const candidates: SkillRouteCandidate[] = []
	let hasExplicit = false

	for (const skill of skills) {
		const reasons: string[] = []
		let score = 0
		const explicit = explicitSkillName(query, skill.name)
		if (explicit) {
			score = 1
			hasExplicit = true
			reasons.push("explicit-name")
		} else {
			const nameTokens = tokens(skill.name)
			const descriptionTokens = tokens(skill.description)
			const nameOverlap = [...nameTokens].filter((token) => queryTokens.has(token)).length
			const descriptionOverlap = [...descriptionTokens].filter((token) => queryTokens.has(token)).length
			if (nameOverlap) {
				score += Math.min(0.7, nameOverlap * 0.45)
				reasons.push("name-overlap")
			}
			if (descriptionOverlap) {
				const denominator = Math.max(2, Math.min(descriptionTokens.size, queryTokens.size))
				score += Math.min(0.55, (descriptionOverlap / denominator) * 0.8)
				reasons.push("description-overlap")
			}
			if (descriptionTokens.size > 80) score -= 0.12
		}

		if (score >= minimumScore || explicit) candidates.push({ skill, score: Math.min(1, score), reasons })
	}

	candidates.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score
		if (a.skill.source !== b.skill.source) return a.skill.source === "project" ? -1 : 1
		const aSpecific = a.skill.modeSlugs?.length ? 1 : 0
		const bSpecific = b.skill.modeSlugs?.length ? 1 : 0
		if (aSpecific !== bSpecific) return bSpecific - aSpecific
		return a.skill.name.localeCompare(b.skill.name)
	})

	return { query, candidates: candidates.slice(0, maxCandidates), explicit: hasExplicit }
}
