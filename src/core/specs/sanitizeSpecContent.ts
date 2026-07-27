/**
 * Strips internal selection-context metadata from document content before it is
 * persisted or rendered.
 *
 * Why this exists: the hidden selection context handed to the model contains an
 * `<anchor id="..." />` element, and its instructions tell the model to use that
 * anchor as a locator. Models occasionally echo internal metadata back into the
 * content they write, which is how `<!-- anchor: 8326fd78e994eb1e -->` ended up
 * inside a user's document. No code path in this repository ever emits such a
 * marker — it originates from the model — so the defence has to be a boundary
 * that inspects outgoing content rather than a fix to a specific emitter.
 *
 * This is deliberately placed at the single write chokepoint
 * (`SpecService.writeDocument`) so agent writes, manual saves, imports and
 * merges are all covered, and no future call site can bypass it by construction.
 *
 * Conservative by design: it removes only markers that are unmistakably internal
 * (a 16-hex-digit anchor id, or a selection-context envelope). It must never
 * mangle legitimate prose, ordinary HTML comments, or user content that happens
 * to contain the word "anchor".
 */

/**
 * `<!-- anchor: 8326fd78e994eb1e -->` and close variants.
 *
 * Anchors are `sha16` values — exactly 16 hex characters (see
 * resolveSelectionContext). Requiring that shape prevents a legitimate comment
 * such as `<!-- anchor: see section 3 -->` from being destroyed.
 */
const ANCHOR_COMMENT = /[ \t]*<!--\s*anchor\s*[:=]\s*[0-9a-f]{16}\s*-->[ \t]*/gi

/** A self-closing `<anchor id="…" />` element copied out of the hidden context. */
const ANCHOR_ELEMENT = /[ \t]*<anchor\s+id\s*=\s*["'][0-9a-f]{16}["']\s*\/?>[ \t]*/gi

/** The whole hidden envelope, if a model ever pastes it back verbatim. */
const SELECTION_CONTEXT_BLOCK = /<selection_context[\s\S]*?<\/selection_context>[ \t]*\r?\n?/gi

/** A stray opening/closing tag left behind by a partial paste. */
const SELECTION_CONTEXT_TAG = /[ \t]*<\/?selection_context(?:\s[^>]*)?>[ \t]*/gi

/** `<!-- doc_hash: … -->` / `<!-- selection: … -->` internal breadcrumbs. */
const INTERNAL_BREADCRUMB = /[ \t]*<!--\s*(?:doc_hash|document_hash|selection_anchor|selection)\s*[:=][^>]*-->[ \t]*/gi

const PATTERNS = [SELECTION_CONTEXT_BLOCK, SELECTION_CONTEXT_TAG, ANCHOR_COMMENT, ANCHOR_ELEMENT, INTERNAL_BREADCRUMB]

export interface SanitizeResult {
	content: string
	/** True when at least one internal marker was removed. */
	removed: boolean
}

/**
 * Returns true when the content carries internal selection metadata. Useful for
 * assertions and diagnostics without paying for the rewrite.
 */
export function containsInternalSelectionMetadata(content: string): boolean {
	if (!content) return false
	return PATTERNS.some((pattern) => {
		pattern.lastIndex = 0
		return pattern.test(content)
	})
}

/**
 * Removes internal selection metadata, returning the cleaned content and
 * whether anything was stripped.
 *
 * Lines that consisted solely of a marker are collapsed rather than left as
 * blank gaps, so removing a leaked anchor does not reflow the document.
 */
export function sanitizeSpecContent(content: string): SanitizeResult {
	if (typeof content !== "string" || !content) {
		return { content: content ?? "", removed: false }
	}

	if (!containsInternalSelectionMetadata(content)) {
		return { content, removed: false }
	}

	let cleaned = content
	for (const pattern of PATTERNS) {
		pattern.lastIndex = 0
		cleaned = cleaned.replace(pattern, "")
	}

	// A marker that occupied its own line leaves an empty line behind. Collapsing
	// runs of three or more newlines restores the standard blank-line separator
	// without disturbing intentional single blank lines elsewhere.
	cleaned = cleaned.replace(/\n{3,}/g, "\n\n")

	return { content: cleaned, removed: cleaned !== content }
}
