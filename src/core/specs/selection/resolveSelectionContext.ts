import { createHash } from "crypto"

/**
 * F-024b — Host-side authoritative selection resolution.
 *
 * The Spec Workspace webview reports what the user selected, but it cannot be
 * trusted as the single source of truth: preview selections have no offsets,
 * the editor may have scrolled/changed, and one-word selections carry almost no
 * information on their own. This module re-resolves every selection against the
 * *current* document content stored in the virtual workspace and derives the
 * full location payload (heading path, block type, table/list/task context,
 * surrounding text, document map).
 *
 * Design rules (from the F-024b requirements):
 * - Prefer exact source mapping from the document content.
 * - Preview selections resolve back to source whenever possible.
 * - Never produce "no location" context. When exact mapping fails we anchor to
 *   the nearest heading section and return that section's content instead.
 */

const SURROUNDING_CHARS = 400
const DEGRADED_SECTION_CHARS = 1200
const MAX_HEADING_SUMMARY_CHARS = 800
const MAX_OCCURRENCES = 500
const MAX_SIBLING_HEADINGS = 6

export type MappingConfidence = "exact" | "approximate" | "unmapped"

export interface SelectionLocationHint {
	selectedText: string
	startOffset?: number
	endOffset?: number
	startLine?: number
	endLine?: number
	mappingConfidence?: MappingConfidence
}

export interface ResolvedSelectionContext {
	/** Text the model should treat as the selection target (source text when remapped). */
	selectedText: string
	startOffset: number
	endOffset: number
	startLine: number
	endLine: number
	mappingConfidence: MappingConfidence
	/** True when the literal selection could not be located and we anchored to a section. */
	degraded: boolean
	/**
	 * True when several locations matched equally well. The location returned is
	 * the best candidate, but the model must confirm the target with the user
	 * rather than editing a possibly-wrong occurrence.
	 */
	ambiguous: boolean
	/** Number of plausible locations found for the selection. */
	candidateCount: number
	headingPath: string[]
	parentHeading?: string
	siblingHeadings: string[]
	blockType: string
	currentPhase?: string
	taskNumber?: string
	taskTitle?: string
	requirementId?: string
	requirementTitle?: string
	listIndex?: number
	parentListType?: string
	nestingLevel?: number
	tableHeading?: string
	tableColumn?: string
	tableColumns?: string[]
	tableRow?: number
	tableRowText?: string
	tableRowsNearby?: string[]
	mermaidDiagramType?: string
	mermaidFenceIndex?: number
	surroundingBefore: string
	surroundingAfter: string
	documentHeadingSummary?: string
	documentTaskCount: number
	documentRequirementCount: number
	totalLines: number
	documentHash: string
	anchor: string
	confidence: number
}

interface LineInfo {
	text: string
	/** Absolute offset of the first character of the line. */
	start: number
	/** Absolute offset just past the last character of the line (excludes the newline). */
	end: number
	/** True when the line sits inside a fenced code block (fence delimiters excluded). */
	inFence: boolean
	/** Ordinal of the enclosing fence among all fences, or -1. */
	fenceIndex: number
	/** Info string of the enclosing fence (e.g. "mermaid"), or "". */
	fenceInfo: string
	/** True when the line itself is a fence delimiter. */
	isFence: boolean
}

interface HeadingInfo {
	line: number
	level: number
	text: string
}

interface CellInfo {
	text: string
	start: number
	end: number
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*)$/
const FENCE_RE = /^\s{0,3}(```+|~~~+)\s*(.*)$/
const CHECKBOX_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX~\/-])\]\s*(.*)$/
const BULLET_RE = /^\s*[-*+]\s+(.*)$/
const NUMBERED_RE = /^\s*(\d+(?:\.\d+)*)[.)]\s+(.*)$/
const TASK_NUMBER_RE = /^(\d+(?:\.\d+)+|\d+)[.)]?\s+(.+)$/
const REQUIREMENT_RE = /\b((?:REQ|FR|NFR|R|US)-\d+(?:\.\d+)*)\b/
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const BLOCKQUOTE_RE = /^\s*>/

/** Splits content into line records with absolute offsets and fence awareness. */
function analyzeLines(content: string): LineInfo[] {
	const rawLines = content.split("\n")
	const lines: LineInfo[] = []
	let offset = 0
	let fenceOpen = false
	let fenceMarker = ""
	let fenceIndex = -1
	let fenceInfo = ""
	let fenceCounter = 0

	for (const text of rawLines) {
		const start = offset
		const end = start + text.length
		const fenceMatch = FENCE_RE.exec(text)
		let isFence = false

		if (fenceMatch) {
			const marker = fenceMatch[1][0].repeat(3)
			if (!fenceOpen) {
				fenceOpen = true
				fenceMarker = marker
				fenceInfo = (fenceMatch[2] || "").trim()
				fenceIndex = fenceCounter++
				isFence = true
			} else if (marker === fenceMarker && !(fenceMatch[2] || "").trim()) {
				isFence = true
				lines.push({ text, start, end, inFence: false, fenceIndex, fenceInfo, isFence })
				offset = end + 1
				fenceOpen = false
				fenceMarker = ""
				fenceInfo = ""
				fenceIndex = -1
				continue
			}
		}

		lines.push({
			text,
			start,
			end,
			inFence: fenceOpen && !isFence,
			fenceIndex: fenceOpen ? fenceIndex : -1,
			fenceInfo: fenceOpen ? fenceInfo : "",
			isFence,
		})
		offset = end + 1
	}

	return lines
}

function collectHeadings(lines: LineInfo[]): HeadingInfo[] {
	const headings: HeadingInfo[] = []
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line.inFence || line.isFence) continue
		const match = HEADING_RE.exec(line.text)
		if (match) {
			headings.push({ line: i, level: match[1].length, text: match[2].trim() })
		}
	}
	return headings
}

/** Builds the root → nearest heading hierarchy for a given line index. */
function headingPathAt(headings: HeadingInfo[], lineIndex: number): HeadingInfo[] {
	const stack: HeadingInfo[] = []
	for (const heading of headings) {
		if (heading.line > lineIndex) break
		while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop()
		stack.push(heading)
	}
	return stack
}

function siblingHeadingsFor(headings: HeadingInfo[], current: HeadingInfo | undefined): string[] {
	if (!current) return []
	const sameLevel = headings.filter((h) => h.level === current.level)
	const index = sameLevel.findIndex((h) => h.line === current.line)
	if (index < 0) return []
	const before = sameLevel.slice(Math.max(0, index - MAX_SIBLING_HEADINGS / 2), index)
	const after = sameLevel.slice(index + 1, index + 1 + MAX_SIBLING_HEADINGS / 2)
	return [...before, ...after].map((h) => h.text).filter(Boolean)
}

function lineIndexForOffset(lines: LineInfo[], offset: number): number {
	let low = 0
	let high = lines.length - 1
	while (low <= high) {
		const mid = (low + high) >> 1
		if (offset < lines[mid].start) high = mid - 1
		else if (offset > lines[mid].end) low = mid + 1
		else return mid
	}
	return Math.min(Math.max(low, 0), lines.length - 1)
}

/** Collapses whitespace runs while keeping a map back to original offsets. */
function normalizeWithMap(value: string): { normalized: string; map: number[] } {
	let normalized = ""
	const map: number[] = []
	let pendingSpace = false
	for (let i = 0; i < value.length; i++) {
		const char = value[i]
		if (/\s/.test(char)) {
			pendingSpace = normalized.length > 0
			continue
		}
		if (pendingSpace) {
			normalized += " "
			map.push(i)
			pendingSpace = false
		}
		normalized += char
		map.push(i)
	}
	return { normalized, map }
}

function findAllOccurrences(haystack: string, needle: string): number[] {
	if (!needle) return []
	const result: number[] = []
	let index = haystack.indexOf(needle)
	while (index !== -1 && result.length < MAX_OCCURRENCES) {
		result.push(index)
		index = haystack.indexOf(needle, index + Math.max(needle.length, 1))
	}
	return result
}

/**
 * A selection short enough that a bare `indexOf` hit proves nothing. "is" or "the"
 * can occur dozens of times, so a single exact match is not evidence of location.
 */
const SHORT_SELECTION_CHARS = 12

/** Candidates within this score of the leader are treated as indistinguishable. */
const AMBIGUITY_MARGIN = 2

interface LocateResult {
	start: number
	end: number
	confidence: MappingConfidence
	degraded: boolean
	matchedText: string
	/**
	 * Set when several locations scored equally well and none could be singled
	 * out. The location is still real (best candidate), but the caller must tell
	 * the model to confirm rather than silently edit the wrong occurrence.
	 */
	ambiguous?: boolean
	/** How many plausible locations were found, when more than one. */
	candidateCount?: number
}

/**
 * Scores a candidate offset by how well its surroundings corroborate the hint.
 *
 * A short common word matches everywhere, so the literal match carries almost no
 * information. What does carry information is the context the webview reported:
 * the line it came from, the offset it claimed, and the section it sat in. This
 * turns "first occurrence wins" into evidence-weighted selection.
 */
function scoreCandidate(
	candidate: number,
	lines: LineInfo[],
	headings: HeadingInfo[],
	hint: SelectionLocationHint,
	hintOffset: number | undefined,
): number {
	let score = 0
	const candidateLineIndex = lineIndexForOffset(lines, candidate)

	// Strongest signal: the webview reported a line and this candidate is on it.
	if (typeof hint.startLine === "number" && hint.startLine >= 1) {
		const hintLineIndex = hint.startLine - 1
		const distance = Math.abs(candidateLineIndex - hintLineIndex)
		if (distance === 0) score += 6
		else if (distance === 1) score += 3
		else if (distance <= 3) score += 1
	}

	// Proximity to a claimed offset, even an unverified one, is corroborating.
	if (typeof hintOffset === "number") {
		const delta = Math.abs(candidate - hintOffset)
		if (delta === 0) score += 5
		else if (delta <= 40) score += 3
		else if (delta <= 400) score += 1
	}

	// Same enclosing section as the hint line.
	if (typeof hint.startLine === "number" && hint.startLine >= 1) {
		const hintPath = headingPathAt(headings, hint.startLine - 1)
			.map((h) => h.text)
			.join(">")
		const candidatePath = headingPathAt(headings, candidateLineIndex)
			.map((h) => h.text)
			.join(">")
		if (hintPath && hintPath === candidatePath) score += 4
	}

	return score
}

/**
 * Locates the selection inside the authoritative content.
 *
 * Order of preference: verbatim hint offsets → unique verbatim match → nearest
 * verbatim match to the hint → whitespace-insensitive match → trimmed match →
 * nearest-section anchor (degraded, never empty).
 */
function locateSelection(
	content: string,
	lines: LineInfo[],
	headings: HeadingInfo[],
	hint: SelectionLocationHint,
): LocateResult {
	const selected = hint.selectedText
	const hintStart = hint.startOffset

	if (
		typeof hintStart === "number" &&
		typeof hint.endOffset === "number" &&
		hintStart >= 0 &&
		hint.endOffset <= content.length &&
		content.slice(hintStart, hint.endOffset) === selected
	) {
		return { start: hintStart, end: hint.endOffset, confidence: "exact", degraded: false, matchedText: selected }
	}

	/**
	 * Chooses among several literal matches using corroborating context rather
	 * than raw proximity to offset 0. When the leaders are tied, the result is
	 * flagged ambiguous so the caller can ask instead of guessing.
	 *
	 * The confidence is never "exact": that label is reserved for a hint whose own
	 * offsets verified verbatim against the source. Reaching here means the text
	 * occurs in more than one place and the location was inferred from
	 * circumstantial evidence, which is by definition a remap. The evidence is
	 * still reflected in the outcome — a corroborated pick stays "approximate"
	 * (~0.7) and proceeds, while an uncorroborated or tied pick is additionally
	 * marked ambiguous and driven below the act/ask threshold.
	 */
	const chooseAmong = (occurrences: number[], text: string): LocateResult => {
		const scored = occurrences.map((offset) => ({
			offset,
			score: scoreCandidate(offset, lines, headings, hint, hintStart),
		}))
		scored.sort((a, b) => b.score - a.score || a.offset - b.offset)

		const leader = scored[0]
		const runnerUp = scored[1]
		const isShort = text.trim().length <= SHORT_SELECTION_CHARS
		// No evidence at all, or a statistical tie between the top candidates.
		const tied = runnerUp !== undefined && leader.score - runnerUp.score < AMBIGUITY_MARGIN
		const unevidenced = leader.score === 0
		const ambiguous = unevidenced || (isShort && tied)

		return {
			start: leader.offset,
			end: leader.offset + text.length,
			confidence: "approximate",
			degraded: false,
			matchedText: text,
			ambiguous: ambiguous || undefined,
			candidateCount: occurrences.length,
		}
	}

	if (selected) {
		const occurrences = findAllOccurrences(content, selected)
		if (occurrences.length === 1) {
			// A single hit is conclusive for a distinctive phrase. For a short,
			// common fragment it may still be coincidence when the hint points
			// elsewhere entirely, so corroborate before claiming "exact".
			const only = occurrences[0]
			const isShort = selected.trim().length <= SHORT_SELECTION_CHARS
			const score = scoreCandidate(only, lines, headings, hint, hintStart)
			const contradicted = isShort && score === 0 && (hint.startLine !== undefined || hintStart !== undefined)
			return {
				start: only,
				end: only + selected.length,
				confidence: contradicted ? "approximate" : "exact",
				degraded: false,
				matchedText: selected,
				candidateCount: 1,
			}
		}
		if (occurrences.length > 1) {
			return chooseAmong(occurrences, selected)
		}

		const trimmed = selected.trim()
		if (trimmed && trimmed !== selected) {
			const trimmedOccurrences = findAllOccurrences(content, trimmed)
			if (trimmedOccurrences.length === 1) {
				return {
					start: trimmedOccurrences[0],
					end: trimmedOccurrences[0] + trimmed.length,
					confidence: "approximate",
					degraded: false,
					matchedText: trimmed,
					candidateCount: 1,
				}
			}
			if (trimmedOccurrences.length > 1) {
				return chooseAmong(trimmedOccurrences, trimmed)
			}
		}

		// Whitespace-insensitive match: preview text often loses markdown spacing.
		const haystack = normalizeWithMap(content)
		const needle = normalizeWithMap(selected)
		if (needle.normalized) {
			const found = haystack.normalized.indexOf(needle.normalized)
			if (found !== -1) {
				const start = haystack.map[found]
				const lastIndex = found + needle.normalized.length - 1
				const end = haystack.map[Math.min(lastIndex, haystack.map.length - 1)] + 1
				return {
					start,
					end,
					confidence: "approximate",
					degraded: false,
					matchedText: content.slice(start, end),
				}
			}
		}
	}

	// Degraded: anchor to the nearest section so the model still receives a real
	// location plus real surrounding content instead of an empty context.
	const anchorOffset =
		typeof hintStart === "number" ? Math.min(hintStart, content.length) : lineAnchorOffset(lines, hint.startLine)
	const anchorLine = lines[lineIndexForOffset(lines, anchorOffset)]
	return {
		start: anchorLine?.start ?? 0,
		end: anchorLine?.end ?? 0,
		confidence: "unmapped",
		degraded: true,
		matchedText: selected,
	}
}

function lineAnchorOffset(lines: LineInfo[], startLine: number | undefined): number {
	if (!startLine || startLine < 1) return 0
	const index = Math.min(startLine - 1, lines.length - 1)
	return lines[index]?.start ?? 0
}

function parseRowCells(line: string): CellInfo[] {
	const cells: CellInfo[] = []
	let cursor = 0
	for (let i = 0; i <= line.length; i++) {
		const isPipe = i < line.length && line[i] === "|" && (i === 0 || line[i - 1] !== "\\")
		if (isPipe || i === line.length) {
			cells.push({ text: line.slice(cursor, i).trim(), start: cursor, end: i })
			cursor = i + 1
		}
	}
	// Drop the empty cells produced by leading/trailing pipes.
	if (cells.length && !cells[0].text && /^\s*\|/.test(line)) cells.shift()
	if (cells.length && !cells[cells.length - 1].text && /\|\s*$/.test(line)) cells.pop()
	return cells
}

function isTableLine(line: LineInfo): boolean {
	if (line.inFence || line.isFence) return false
	const text = line.text
	if (!text.includes("|")) return false
	if (/^\s*\|/.test(text)) return true
	// A bare pipe inside prose is not a table; require at least two columns.
	return (text.match(/\|/g) ?? []).length >= 2
}

interface TableBlock {
	startLine: number
	endLine: number
	headerLine: number
	firstDataLine: number
}

function tableBlockAt(lines: LineInfo[], lineIndex: number): TableBlock | undefined {
	if (!isTableLine(lines[lineIndex])) return undefined
	let start = lineIndex
	while (start > 0 && isTableLine(lines[start - 1])) start--
	let end = lineIndex
	while (end < lines.length - 1 && isTableLine(lines[end + 1])) end++
	if (end === start) return undefined

	const separatorIsSecond = TABLE_SEPARATOR_RE.test(lines[start + 1].text)
	return {
		startLine: start,
		endLine: end,
		headerLine: start,
		// GFM tables have a separator row; hand-written spec tables often do not.
		firstDataLine: separatorIsSecond ? start + 2 : start + 1,
	}
}

function detectBlockType(line: LineInfo): string {
	if (line.inFence) return line.fenceInfo.toLowerCase().startsWith("mermaid") ? "mermaid" : "code"
	if (line.isFence) return line.fenceInfo.toLowerCase().startsWith("mermaid") ? "mermaid" : "code"
	if (HEADING_RE.test(line.text)) return "heading"
	if (CHECKBOX_RE.test(line.text)) return "checkbox"
	if (BLOCKQUOTE_RE.test(line.text)) return "blockquote"
	if (BULLET_RE.test(line.text)) return "bullet"
	if (NUMBERED_RE.test(line.text)) return "numbered"
	if (!line.text.trim()) return "blank"
	return "paragraph"
}

function indentWidth(text: string): number {
	let width = 0
	for (const char of text) {
		if (char === " ") width += 1
		else if (char === "\t") width += 4
		else break
	}
	return width
}

function isListLine(line: LineInfo): boolean {
	if (line.inFence || line.isFence) return false
	return CHECKBOX_RE.test(line.text) || BULLET_RE.test(line.text) || NUMBERED_RE.test(line.text)
}

interface ListContext {
	listIndex: number
	parentListType: string
	nestingLevel: number
}

function detectListContext(lines: LineInfo[], lineIndex: number): ListContext | undefined {
	const line = lines[lineIndex]
	if (!isListLine(line)) return undefined

	const indent = indentWidth(line.text)
	const parentListType = CHECKBOX_RE.test(line.text)
		? "checkbox"
		: NUMBERED_RE.test(line.text)
			? "numbered"
			: "bullet"

	// Walk up through the contiguous list block, counting same-indent siblings
	// and distinct smaller indents (the real nesting depth).
	let listIndex = 0
	const ancestorIndents = new Set<number>()
	for (let i = lineIndex - 1; i >= 0; i--) {
		const candidate = lines[i]
		if (!candidate.text.trim()) {
			// A blank line only ends the list when the next content is not a list item.
			const previous = lines[i - 1]
			if (!previous || !isListLine(previous)) break
			continue
		}
		if (!isListLine(candidate)) {
			if (indentWidth(candidate.text) > indent) continue // wrapped continuation line
			break
		}
		const candidateIndent = indentWidth(candidate.text)
		if (candidateIndent === indent) listIndex++
		else if (candidateIndent < indent) ancestorIndents.add(candidateIndent)
	}

	return { listIndex, parentListType, nestingLevel: ancestorIndents.size }
}

function extractTaskInfo(text: string): { taskNumber?: string; taskTitle?: string } {
	const checkbox = CHECKBOX_RE.exec(text)
	const numberedLine = checkbox ? undefined : NUMBERED_RE.exec(text)
	// The checkbox body keeps its own numbering ("- [x] 2.1 Ledger schema"), so it
	// must be matched before any list-marker stripping or the number is lost.
	const body = checkbox ? checkbox[2].trim() : numberedLine ? text.trim() : undefined
	if (!body) return {}

	const numbered = TASK_NUMBER_RE.exec(body)
	if (numbered) return { taskNumber: numbered[1], taskTitle: numbered[2].trim() }
	if (checkbox) return { taskTitle: body }
	if (numberedLine) return { taskNumber: numberedLine[1], taskTitle: numberedLine[2].trim() }
	return {}
}

function sha16(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

function clampText(value: string, max: number): string {
	return value.length > max ? value.slice(0, max) : value
}

/**
 * Resolves a webview selection against the authoritative document content and
 * returns a complete, never-empty location payload.
 */
export function resolveSelectionContext(content: string, hint: SelectionLocationHint): ResolvedSelectionContext {
	const lines = analyzeLines(content)
	const headings = collectHeadings(lines)
	const located = locateSelection(content, lines, headings, hint)

	const startLineIndex = lineIndexForOffset(lines, located.start)
	const endLineIndex = lineIndexForOffset(lines, Math.max(located.start, located.end - 1))
	const startLineInfo = lines[startLineIndex]

	const path = headingPathAt(headings, startLineIndex)
	const parent = path[path.length - 1]
	const headingPath = path.map((h) => h.text).filter(Boolean)
	const currentPhase = [...path].reverse().find((h) => /phase\b/i.test(h.text))?.text

	// Single-line classification. Upgraded to "table" below once a real
	// multi-line table block is confirmed (a lone pipe in prose is not a table).
	const lineBlockType = detectBlockType(startLineInfo)

	// Table context — resolved from real cell boundaries, not character averages.
	let tableHeading: string | undefined
	let tableColumn: string | undefined
	let tableColumns: string[] | undefined
	let tableRow: number | undefined
	let tableRowText: string | undefined
	let tableRowsNearby: string[] | undefined
	const table = tableBlockAt(lines, startLineIndex)
	if (table) {
		const headerCells = parseRowCells(lines[table.headerLine].text)
		tableColumns = headerCells.map((c) => c.text)
		tableHeading = parent?.text
		tableRowText = startLineInfo.text.trim()

		if (startLineIndex >= table.firstDataLine) {
			tableRow = startLineIndex - table.firstDataLine
		}

		const positionInLine = Math.max(0, located.start - startLineInfo.start)
		const rowCells = parseRowCells(startLineInfo.text)
		const cellIndex = rowCells.findIndex((cell) => positionInLine >= cell.start && positionInLine <= cell.end)
		const resolvedIndex = cellIndex >= 0 ? cellIndex : rowCells.length - 1
		tableColumn = headerCells[resolvedIndex]?.text || headerCells[headerCells.length - 1]?.text

		const nearby: string[] = []
		if (startLineIndex - 1 >= table.firstDataLine) nearby.push(lines[startLineIndex - 1].text.trim())
		if (startLineIndex + 1 <= table.endLine) nearby.push(lines[startLineIndex + 1].text.trim())
		if (nearby.length) tableRowsNearby = nearby
	}

	const blockType = table ? "table" : lineBlockType
	const list = table ? undefined : detectListContext(lines, startLineIndex)
	const { taskNumber, taskTitle } = extractTaskInfo(startLineInfo.text)

	const requirementMatch =
		REQUIREMENT_RE.exec(startLineInfo.text) ?? (parent ? REQUIREMENT_RE.exec(parent.text) : null)
	const requirementId = requirementMatch?.[1]
	const requirementTitle = requirementId
		? (REQUIREMENT_RE.test(startLineInfo.text) ? startLineInfo.text : (parent?.text ?? ""))
				.replace(REQUIREMENT_RE, "")
				.replace(/^[\s:#\-–—.]+/, "")
				.trim() || undefined
		: undefined

	let mermaidDiagramType: string | undefined
	let mermaidFenceIndex: number | undefined
	if (blockType === "mermaid" && startLineInfo.fenceIndex >= 0) {
		let mermaidOrdinal = -1
		const seen = new Set<number>()
		for (const line of lines) {
			if (line.fenceIndex >= 0 && !seen.has(line.fenceIndex)) {
				seen.add(line.fenceIndex)
				if (line.fenceInfo.toLowerCase().startsWith("mermaid")) {
					mermaidOrdinal++
					if (line.fenceIndex === startLineInfo.fenceIndex) {
						mermaidFenceIndex = mermaidOrdinal
					}
				}
			}
		}
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].fenceIndex === startLineInfo.fenceIndex && lines[i].inFence && lines[i].text.trim()) {
				mermaidDiagramType = lines[i].text.trim()
				break
			}
		}
	}

	// Surrounding content. When mapping degraded we widen to the whole nearest
	// section so the agent still sees where the fragment lives.
	let surroundingBefore: string
	let surroundingAfter: string
	if (located.degraded) {
		const sectionStartLine = parent ? parent.line : 0
		let sectionEndLine = lines.length - 1
		for (const heading of headings) {
			if (parent && heading.line > parent.line && heading.level <= parent.level) {
				sectionEndLine = heading.line - 1
				break
			}
		}
		const sectionStart = lines[sectionStartLine]?.start ?? 0
		const sectionEnd = lines[Math.max(sectionStartLine, sectionEndLine)]?.end ?? content.length
		// Nothing was actually matched, so nothing may be excised: the anchor line
		// is carried in `after` and the section arrives whole, with no hole where
		// the fragment was believed to be.
		surroundingBefore = clampText(content.slice(sectionStart, located.start), DEGRADED_SECTION_CHARS)
		surroundingAfter = clampText(content.slice(located.start, sectionEnd), DEGRADED_SECTION_CHARS)
	} else {
		surroundingBefore = content.slice(Math.max(0, located.start - SURROUNDING_CHARS), located.start)
		surroundingAfter = content.slice(located.end, located.end + SURROUNDING_CHARS)
	}

	const documentTaskCount = lines.filter((line) => !line.inFence && CHECKBOX_RE.test(line.text)).length
	const documentRequirementCount = lines.filter((line) => !line.inFence && REQUIREMENT_RE.test(line.text)).length
	const documentHeadingSummary = headings.length
		? clampText(headings.map((h) => `${"#".repeat(h.level)} ${h.text}`).join(", "), MAX_HEADING_SUMMARY_CHARS)
		: undefined

	const documentHash = sha16(content)
	const startLine = startLineIndex + 1
	const endLine = endLineIndex + 1
	const anchor = sha16(`${headingPath.join(">")}|${startLine}-${endLine}|${documentHash}`)

	let confidence = located.confidence === "exact" ? 0.95 : located.confidence === "approximate" ? 0.7 : 0.4
	if (headingPath.length) confidence += 0.03
	if (blockType !== "paragraph" && blockType !== "blank") confidence += 0.02
	// Several indistinguishable candidates means the location is a coin flip
	// between them; the score must say so rather than inheriting "approximate".
	if (located.ambiguous) {
		confidence = Math.min(confidence, 0.35)
		if (located.candidateCount && located.candidateCount > 2) confidence -= 0.05
	}
	confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))))

	return {
		ambiguous: located.ambiguous === true,
		candidateCount: located.candidateCount ?? 1,
		selectedText: located.matchedText || hint.selectedText,
		startOffset: located.start,
		endOffset: located.end,
		startLine,
		endLine,
		mappingConfidence: located.confidence,
		degraded: located.degraded,
		headingPath,
		parentHeading: parent?.text,
		siblingHeadings: siblingHeadingsFor(headings, parent),
		blockType,
		currentPhase,
		taskNumber,
		taskTitle,
		requirementId,
		requirementTitle,
		listIndex: list?.listIndex,
		parentListType: list?.parentListType,
		nestingLevel: list?.nestingLevel,
		tableHeading,
		tableColumn,
		tableColumns,
		tableRow,
		tableRowText,
		tableRowsNearby,
		mermaidDiagramType,
		mermaidFenceIndex,
		surroundingBefore,
		surroundingAfter,
		documentHeadingSummary,
		documentTaskCount,
		documentRequirementCount,
		totalLines: lines.length,
		documentHash,
		anchor,
		confidence,
	}
}
