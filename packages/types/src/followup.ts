import { z } from "zod"

/**
 * Interface for follow-up data structure used in follow-up questions
 * This represents the data structure for follow-up questions that the LLM can ask
 * to gather more information needed to complete a task.
 */
export interface FollowUpData {
	/** The question being asked by the LLM */
	question?: string
	/** Array of suggested answers that the user can select */
	suggest?: Array<SuggestionItem>
}

/**
 * Interface for a suggestion item with optional mode switching
 */
export interface SuggestionItem {
	/** The text of the suggestion */
	answer: string
	/** Optional mode to switch to when selecting this suggestion */
	mode?: string
}

export const getSuggestionMode = (mode: unknown): string | undefined => {
	if (typeof mode === "string" && mode.trim().length > 0) {
		return mode.trim()
	}

	if (mode && typeof mode === "object" && "mode_slug" in mode) {
		const modeSlug = (mode as { mode_slug?: unknown }).mode_slug
		return typeof modeSlug === "string" && modeSlug.trim().length > 0 ? modeSlug.trim() : undefined
	}

	return undefined
}

/**
 * Zod schema for SuggestionItem
 */
export const suggestionItemSchema = z.object({
	answer: z.string(),
	mode: z.string().optional(),
})

/**
 * Zod schema for FollowUpData
 */
export const followUpDataSchema = z.object({
	question: z.string().optional(),
	suggest: z.array(suggestionItemSchema).optional(),
})

export type FollowUpDataType = z.infer<typeof followUpDataSchema>

/**
 * Result of decoding a follow-up payload. Keeping parsing in the shared types
 * package ensures extension-host producers and webview consumers use the same
 * runtime contract rather than trusting a TypeScript-only type assertion.
 */
export type ParsedFollowUpData = { valid: true; data: FollowUpDataType } | { valid: false; fallbackText: string }

const MAX_ELICITATIONS = 12
const MAX_ELICITATION_TEXT_LENGTH = 4_000

/** Decode XML entities used by text-form interaction markup. */
function decodeEntities(value: string): string {
	return value
		.replace(/&quot;/gi, '"')
		.replace(/&apos;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&amp;/gi, "&")
}

/**
 * Reads quoted attributes without depending on their order or quote style.
 * This intentionally accepts only quoted values: unquoted attributes are too
 * ambiguous to safely turn into interactive UI.
 */
function readAttribute(attributes: string, name: string): string | undefined {
	const match = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(attributes)
	return match?.[2] === undefined ? undefined : decodeEntities(match[2]).trim()
}

/** Remove recognized interaction tags while retaining any explanatory prose. */
function stripElicitationMarkup(value: string): string {
	return value
		.replace(/<\s*\/?\s*ElicitationsGroup\b[^>]*>/gi, "")
		.replace(/<\s*Elicitation\b[^>]*\/?>/gi, "")
		.replace(/<\s*\/?\s*FollowUp\b[^>]*>/gi, "")
		.replace(/<\s*\/?\s*Suggestion\b[^>]*>/gi, "")
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
}

/**
 * Converts compatibility markup emitted by older/weak models into the
 * existing follow-up wire format. It is deliberately bounded and supports
 * self-closing Elicitation definitions only; malformed groups are never
 * surfaced as raw markup.
 */
function parseElicitationMarkup(text: string): ParsedFollowUpData | undefined {
	const group = /<\s*ElicitationsGroup\b([^>]*)>([\s\S]*?)<\s*\/\s*ElicitationsGroup\s*>/i.exec(text)
	if (!group) {
		return undefined
	}

	const groupAttributes = group[1] ?? ""
	const groupContent = group[2] ?? ""
	const question = readAttribute(groupAttributes, "message")
	const suggestions: SuggestionItem[] = []
	const elicitation = /<\s*Elicitation\b([^>]*?)\/\s*>/gi
	let match: RegExpExecArray | null
	while ((match = elicitation.exec(groupContent)) !== null && suggestions.length < MAX_ELICITATIONS) {
		const attributes = match[1] ?? ""
		const answer = readAttribute(attributes, "query") ?? readAttribute(attributes, "label")
		if (answer && answer.length <= MAX_ELICITATION_TEXT_LENGTH) {
			suggestions.push({ answer })
		}
	}

	if (!question || question.length > MAX_ELICITATION_TEXT_LENGTH || suggestions.length === 0) {
		return { valid: false, fallbackText: stripElicitationMarkup(text) }
	}

	return { valid: true, data: { question, suggest: suggestions } }
}

/**
 * Converts `<FollowUp>` tags emitted by some models into the existing follow-up
 * wire format. Supports two shapes:
 *
 *   <FollowUp question="..." suggestions="A,B,C" />
 *   <FollowUp question="..."><Suggestion>A</Suggestion><Suggestion>B</Suggestion></FollowUp>
 */
function parseFollowUpMarkup(text: string): ParsedFollowUpData | undefined {
	// Match either a self-closing or open+close FollowUp tag.
	const tag =
		/<\s*FollowUp\b([^>]*)\/\s*>/i.exec(text) ?? /<\s*FollowUp\b([^>]*)>([\s\S]*?)<\s*\/\s*FollowUp\s*>/i.exec(text)
	if (!tag) {
		return undefined
	}

	const attributes = tag[1] ?? ""
	const innerContent = tag[2] ?? ""
	const question = readAttribute(attributes, "question") ?? readAttribute(attributes, "message")
	const suggestions: SuggestionItem[] = []

	// Attribute-based suggestions: suggestions="A,B,C" or suggestions="A|B|C"
	const suggestionsAttr = readAttribute(attributes, "suggestions")
	if (suggestionsAttr) {
		const items = suggestionsAttr
			.split(/[,|]/)
			.map((s) => s.trim())
			.filter(Boolean)
		for (const item of items) {
			if (suggestions.length < MAX_ELICITATIONS && item.length <= MAX_ELICITATION_TEXT_LENGTH) {
				suggestions.push({ answer: item })
			}
		}
	}

	// Child-element suggestions: <Suggestion>...</Suggestion>
	if (innerContent) {
		const childSuggestion = /<\s*Suggestion\b[^>]*>([\s\S]*?)<\s*\/\s*Suggestion\s*>/gi
		let match: RegExpExecArray | null
		while ((match = childSuggestion.exec(innerContent)) !== null && suggestions.length < MAX_ELICITATIONS) {
			const answer = (match[1] ?? "").trim()
			if (answer && answer.length <= MAX_ELICITATION_TEXT_LENGTH) {
				suggestions.push({ answer })
			}
		}
	}

	if (!question || question.length > MAX_ELICITATION_TEXT_LENGTH) {
		return { valid: false, fallbackText: stripElicitationMarkup(text) }
	}

	// A FollowUp with just a question (no suggestions) is still valid — the
	// renderer will show the question as markdown without buttons.
	return { valid: true, data: { question, suggest: suggestions.length > 0 ? suggestions : undefined } }
}

/**
 * Parse legacy JSON first, then accept compatible Elicitation and FollowUp
 * markup emitted as assistant text. Invalid payloads return a display-safe
 * fallback so raw protocol tags never reach the chat renderer.
 */
export function parseFollowUpData(text: string): ParsedFollowUpData {
	try {
		const parsed = followUpDataSchema.safeParse(JSON.parse(text))
		if (parsed.success) {
			return { valid: true, data: parsed.data }
		}
	} catch {
		// Compatibility markup is not JSON; continue to its bounded parsers.
	}

	const followUp = parseFollowUpMarkup(text)
	if (followUp) {
		return followUp
	}

	const elicitation = parseElicitationMarkup(text)
	if (elicitation) {
		return elicitation
	}

	return { valid: false, fallbackText: stripElicitationMarkup(text) }
}
