import { randomUUID } from "crypto"

/** Supported AI operations for a virtual Spec Workspace selection. */
export type SelectionContextAction =
	| "rewrite"
	| "improve"
	| "remove"
	| "custom"
	| "summarize"
	| "explain"
	| "translate"
	| "generate"

export interface SelectionContextInput {
	action: SelectionContextAction
	specId: string
	specTitle: string
	documentKind: string
	documentTitle: string
	revision?: number
	selectedText: string
	source: "editor" | "preview"
	startOffset?: number
	endOffset?: number
	startLine?: number
	endLine?: number
	mappingConfidence: "exact" | "approximate" | "unmapped"
	/** Heading hierarchy from root to nearest heading (e.g. ["UI","Theme","Colors"]). */
	headingPath?: string[]
	/** Detected block type: heading, task, bullet, numbered, checkbox, paragraph, table, mermaid, code. */
	blockType?: string
	/** Task number if selection is inside a numbered task line (e.g. "12.4"). */
	taskNumber?: string
	/** Task title text if inside a task line. */
	taskTitle?: string
	/** Current phase heading (e.g. "Phase 12"). */
	currentPhase?: string
	/** List item index within parent list. */
	listIndex?: number
	/** Parent list type: bullet, numbered, checkbox. */
	parentListType?: string
	/** Nesting depth for lists. */
	nestingLevel?: number
	/** Table caption or nearest heading above table. */
	tableHeading?: string
	/** Column header if inside a table cell. */
	tableColumn?: string
	/** All column headers of the containing table, in order. */
	tableColumns?: string[]
	/** Data-row index inside a table (0-based, header/separator excluded). */
	tableRow?: number
	/** Full source text of the table row containing the selection. */
	tableRowText?: string
	/** Adjacent table rows (previous/next) for orientation. */
	tableRowsNearby?: string[]
	/** Mermaid diagram type (e.g. "graph LR", "sequenceDiagram"). */
	mermaidDiagramType?: string
	/** Index of the mermaid fence in the document (0-based). */
	mermaidFenceIndex?: number
	/** ~200-400 chars of content before the selection. */
	surroundingBefore?: string
	/** ~200-400 chars of content after the selection. */
	surroundingAfter?: string
	/** Nearest heading text directly above the selection. */
	parentHeading?: string
	/** Adjacent heading texts at the same nesting level. */
	siblingHeadings?: string[]
	/** SHA-256 of the full document content (first 16 hex chars). */
	documentHash?: string
	/** Stable anchor: sha256(headingPath + lineRange + documentHash), first 16 hex chars. */
	anchor?: string
	/** Confidence score 0-1 computed from text uniqueness, heading path, etc. */
	confidence?: number
	/** Requirement ID if selection is inside a requirement line (e.g. "REQ-001"). */
	requirementId?: string
	/** Requirement title text if inside a requirement line. */
	requirementTitle?: string
	/** Document heading summary for agent orientation. */
	documentHeadingSummary?: string
	/** Number of tasks in the document. */
	documentTaskCount?: number
	/** Number of requirements in the document. */
	documentRequirementCount?: number
	/** Total lines in the document. */
	totalLines?: number
	/** 1-based document order within the spec (e.g. 1 for requirements, 2 for design, 3 for tasks). */
	docOrder?: number
	/** Human-readable label for the document kind (e.g. "Requirements", "Design"). */
	docLabel?: string
	/**
	 * True when the literal selection could not be located in the current document
	 * and the context was anchored to the nearest heading section instead. The
	 * location data is still real — it is section-level rather than fragment-level.
	 */
	degradedMapping?: boolean
	/**
	 * True when several locations in the document matched the selection equally
	 * well — typical for a short common word like "is". The stored location is the
	 * best candidate, but the agent must confirm the target with the user instead
	 * of editing a possibly-wrong occurrence.
	 */
	ambiguousLocation?: boolean
	/** Number of plausible locations found, when more than one. */
	candidateCount?: number
}

export interface SelectionContext extends SelectionContextInput {
	token: string
	createdAt: number
}

const MAX_ENTRIES = 50
const TTL_MS = 10 * 60 * 1000

/**
 * One-use, in-memory handoff for agent-only selection context. Tokens are opaque
 * to the webview and are never placed in the visible chat prompt.
 */
export class SelectionContextStore {
	private readonly contexts = new Map<string, SelectionContext>()

	create(input: SelectionContextInput): string {
		this.prune()
		const token = randomUUID()
		this.contexts.set(token, { ...input, token, createdAt: Date.now() })
		while (this.contexts.size > MAX_ENTRIES) {
			const oldest = this.contexts.keys().next().value
			if (!oldest) break
			this.contexts.delete(oldest)
		}
		return token
	}

	consume(token: string | undefined): SelectionContext | undefined {
		if (!token) return undefined
		this.prune()
		const context = this.contexts.get(token)
		if (context) this.contexts.delete(token)
		return context
	}

	private prune(now = Date.now()): void {
		for (const [token, context] of this.contexts) {
			if (now - context.createdAt > TTL_MS) this.contexts.delete(token)
		}
	}
}

export const selectionContextStore = new SelectionContextStore()

export function selectionContextLabel(action: SelectionContextAction): string {
	switch (action) {
		case "rewrite":
			return "✨ Rewrite Selected Content"
		case "improve":
			return "✨ Improve Selected Content"
		case "remove":
			return "🗑 Remove Selected Content"
		default:
			return "✨ Selection Ready"
	}
}

/** Serializes trusted selection data into a model-only initial context block. */
export function formatHiddenSelectionContext(context: SelectionContext): string {
	const AMP = "&" + "amp;"
	const LT = "&" + "lt;"
	const GT = "&" + "gt;"
	const DQ = "&" + "quot;"
	const SQ = "&" + "apos;"
	const escape = (value: string | number | undefined): string =>
		String(value ?? "")
			.replace(/&/g, AMP)
			.replace(/</g, LT)
			.replace(/>/g, GT)
			.replace(/"/g, DQ)
			.replace(/'/g, SQ)

	const headingPathStr = context.headingPath && context.headingPath.length ? context.headingPath.join(" \u2192 ") : ""

	const siblingStr =
		context.siblingHeadings && context.siblingHeadings.length ? context.siblingHeadings.join(", ") : ""

	const columnsStr = context.tableColumns && context.tableColumns.length ? context.tableColumns.join(" | ") : ""

	const nearbyRowsStr =
		context.tableRowsNearby && context.tableRowsNearby.length ? context.tableRowsNearby.join("\n") : ""

	return `<selection_context source="${escape(context.source)}" action="${escape(context.action)}" mapping_confidence="${escape(context.mappingConfidence)}">
<spec id="${escape(context.specId)}" title="${escape(context.specTitle)}" />
<document kind="${escape(context.documentKind)}" title="${escape(context.documentTitle)}" revision="${escape(context.revision)}" doc_hash="${escape(context.documentHash)}"${context.docOrder !== undefined ? ` doc_order="${escape(context.docOrder)}"` : ""}${context.docLabel ? ` doc_label="${escape(context.docLabel)}"` : ""} />
<anchor id="${escape(context.anchor)}" />
<range start_offset="${escape(context.startOffset)}" end_offset="${escape(context.endOffset)}" start_line="${escape(context.startLine)}" end_line="${escape(context.endLine)}" />
${context.ambiguousLocation ? `<ambiguous_location candidates="${escape(context.candidateCount ?? 2)}">The selected text appears in multiple places and the available context does not identify which one the user meant. Do NOT edit any occurrence. Use ask_followup_question to ask which location is intended, describing the candidates by heading and line number.</ambiguous_location>\n` : ""}\
${context.confidence !== undefined ? `<confidence>${escape(context.confidence.toFixed(2))}</confidence>\n` : ""}${context.degradedMapping ? `<location_note>The exact selected fragment could not be re-located in the current document. The location below is the nearest enclosing section, and context_before/context_after contain that section's real content. Work from this section — do NOT claim the context is missing.</location_note>\n` : ""}${context.requirementId ? `<requirement id="${escape(context.requirementId)}" title="${escape(context.requirementTitle)}" />\n` : ""}${context.totalLines ? `<document_map total_lines="${escape(context.totalLines)}" headings_count="${escape(context.documentHeadingSummary?.split(",").length ?? 0)}" tasks_count="${escape(context.documentTaskCount ?? 0)}" requirements_count="${escape(context.documentRequirementCount ?? 0)}" />\n` : ""}${context.documentHeadingSummary ? `<heading_summary>${escape(context.documentHeadingSummary)}</heading_summary>\n` : ""}${headingPathStr ? `<heading_path>${escape(headingPathStr)}</heading_path>\n` : ""}${context.blockType ? `<block_type>${escape(context.blockType)}</block_type>\n` : ""}${context.parentHeading ? `<parent_heading>${escape(context.parentHeading)}</parent_heading>\n` : ""}${siblingStr ? `<sibling_headings>${escape(siblingStr)}</sibling_headings>\n` : ""}${context.currentPhase ? `<phase>${escape(context.currentPhase)}</phase>\n` : ""}${context.taskNumber ? `<task number="${escape(context.taskNumber)}" title="${escape(context.taskTitle)}" />\n` : ""}${context.parentListType ? `<list type="${escape(context.parentListType)}" index="${escape(context.listIndex)}" nesting="${escape(context.nestingLevel)}" />\n` : ""}${context.tableHeading || context.tableRowText ? `<table${context.tableHeading ? ` heading="${escape(context.tableHeading)}"` : ""} column="${escape(context.tableColumn)}" row="${escape(context.tableRow)}"${columnsStr ? ` columns="${escape(columnsStr)}"` : ""}>${context.tableRowText ? `\n<table_row>${escape(context.tableRowText)}</table_row>` : ""}${nearbyRowsStr ? `\n<table_rows_nearby>${escape(nearbyRowsStr)}</table_rows_nearby>` : ""}\n</table>\n` : ""}${context.mermaidDiagramType ? `<mermaid type="${escape(context.mermaidDiagramType)}" fence_index="${escape(context.mermaidFenceIndex)}" />\n` : ""}<selected_text>
${escape(context.selectedText)}
</selected_text>${context.surroundingBefore ? `\n<context_before>${escape(context.surroundingBefore)}</context_before>` : ""}${context.surroundingAfter ? `\n<context_after>${escape(context.surroundingAfter)}</context_after>` : ""}
<instructions>
You are editing inside a virtual Spec Workspace document. The user selected a fragment and requested: ${escape(context.action)}.

CRITICAL RULES:
1. NEVER say "context is missing" or "context not found." The selection context above IS the context and always contains a real location. (The one exception is an ambiguous_location note below: there, asking which occurrence the user meant is required.)
2. Use heading_path, block_type, line range, surrounding text, and anchor as your precise locator. These are internal locators for YOUR use only — never write an anchor id, doc_hash, or any part of this context into document content.
3. If selected text is very short (one word, symbol, number, checkbox), resolve it using the full context: heading path + block type + line number + surrounding text. The context tells you exactly where this fragment lives.
4. Perform ONLY the requested action (${escape(context.action)}) at the exact anchor location.
5. Use virtual Spec Workspace tools (read_spec, write_spec) only. Never create new specs unless the user explicitly asks.
6. For write_spec: use search_replace mode with the old_string being the exact current content at the anchor location, and new_string being your modification.
7. Preserve all surrounding content. Make surgical edits only.
8. If an ambiguous_location note is present, do NOT edit. Ask which occurrence the user meant. Otherwise, if confidence is low (below 0.5) but the location is unambiguous, proceed using the best available context.
9. Never insert marker comments such as &lt;!-- anchor: ... --&gt; into the document. The user's spec must contain only their own content.
</instructions>
</selection_context>`
}
