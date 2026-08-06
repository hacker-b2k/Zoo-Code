/**
 * F-008: Spec preview rendering helpers.
 *
 * Pure TypeScript — no DOM, no external dependencies. Unit-testable.
 *
 * These functions convert spec markdown into sanitized HTML for the
 * Spec Workspace preview pane. Mermaid code blocks are replaced with
 * `<div class="mermaid-slot" data-mermaid="<encoded>">` placeholders that
 * the browser bundle (specPreviewBundle.ts) renders into SVG after DOM
 * insertion.
 *
 * Security model (html: false semantics):
 * - All input text is HTML-escaped before processing.
 * - Only known-safe HTML elements are generated.
 * - No `<script>`, no event handlers, no `javascript:` URIs.
 * - Defense-in-depth `sanitizePreviewHtml()` strips any dangerous patterns.
 */

/** Maximum markdown size before the preview truncates (100 KB). */
export const PREVIEW_MAX_CHARS = 100_000

/**
 * Mermaid theme variables matching webview-ui MermaidBlock.tsx for visual
 * consistency between the chat webview and the Spec Workspace preview.
 */
export const MERMAID_THEME: Record<string, string> = {
	background: "#1e1e1e",
	textColor: "#ffffff",
	mainBkg: "#2d2d2d",
	nodeBorder: "#888888",
	lineColor: "#cccccc",
	primaryColor: "#3c3c3c",
	primaryTextColor: "#ffffff",
	primaryBorderColor: "#888888",
	secondaryColor: "#2d2d2d",
	tertiaryColor: "#454545",
	classText: "#ffffff",
	labelColor: "#ffffff",
	actorLineColor: "#cccccc",
	actorBkg: "#2d2d2d",
	actorBorder: "#888888",
	actorTextColor: "#ffffff",
	fillType0: "#2d2d2d",
	fillType1: "#3c3c3c",
	fillType2: "#454545",
	noteTextColor: "#ffffff",
	noteBkgColor: "#454545",
	noteBorderColor: "#888888",
	critBorderColor: "#ff9580",
	critBkgColor: "#803d36",
	taskTextColor: "#ffffff",
	taskTextOutsideColor: "#ffffff",
	taskTextLightColor: "#ffffff",
	sectionBkgColor: "#2d2d2d",
	sectionBkgColor2: "#3c3c3c",
	altBackground: "#2d2d2d",
	linkColor: "#6cb6ff",
	compositeBackground: "#2d2d2d",
	compositeBorder: "#888888",
	titleColor: "#ffffff",
	fontSize: "16px",
	fontFamily: "var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif)",
}

/** HTML entity for escaping text content. Uses \x26 to avoid HTML-entity decoding. */
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "\x26amp;")
		.replace(/</g, "\x26lt;")
		.replace(/>/g, "\x26gt;")
		.replace(/"/g, "\x26quot;")
		.replace(/'/g, "\x26#39;")
}

/** Escape a string for safe use inside an HTML attribute value. */
export function escapeAttr(s: string): string {
	return s
		.replace(/&/g, "\x26amp;")
		.replace(/"/g, "\x26quot;")
		.replace(/'/g, "\x26#39;")
		.replace(/</g, "\x26lt;")
		.replace(/>/g, "\x26gt;")
}

/**
 * Defense-in-depth sanitizer. Strips dangerous patterns from generated HTML.
 * Since `renderSpecMarkdown` escapes all input and only generates known-safe
 * elements, this is a safety net — it removes any residual `<script>` tags,
 * event handler attributes (`on*`), and `javascript:` URIs.
 */
export function sanitizePreviewHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
		.replace(/\son\w+\s*=\s*'[^']*'/gi, "")
		.replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
		.replace(/href\s*=\s*"\s*javascript:[^"]*"/gi, 'href="#"')
		.replace(/href\s*=\s*'\s*javascript:[^']*'/gi, "href='#'")
		.replace(/src\s*=\s*"\s*javascript:[^"]*"/gi, "")
		.replace(/src\s*=\s*'\s*javascript:[^']*'/gi, "")
}

/** Interface for a mermaid code block slot extracted from rendered HTML. */
export interface MermaidSlot {
	/** The index of the slot in the HTML (0-based). */
	index: number
	/** The raw mermaid diagram code (URL-decoded). */
	code: string
}

/**
 * Extract mermaid slot data from rendered HTML.
 * Finds all `<div class="mermaid-slot" data-mermaid="...">` elements.
 */
export function extractMermaidSlots(html: string): MermaidSlot[] {
	const slots: MermaidSlot[] = []
	const regex = /<div class="mermaid-slot"[^>]*data-mermaid="([^"]*)"[^>]*><\/div>/g
	let match: RegExpExecArray | null
	let index = 0
	while ((match = regex.exec(html)) !== null) {
		slots.push({ index: index++, code: decodeURIComponent(match[1]) })
	}
	return slots
}

// ---------------------------------------------------------------------------
// Inline element rendering
// ---------------------------------------------------------------------------

/**
 * Render inline markdown elements (bold, italic, strikethrough, inline code,
 * links) within a block of already-escaped text.
 *
 * Input is expected to be raw markdown text (not yet HTML-escaped). The
 * function escapes HTML first, then applies inline transformations.
 */
export function renderInline(text: string): string {
	let result = escapeHtml(text)

	// Inline code — protect content from further processing.
	// Use a placeholder to avoid double-processing code content.
	const codeChunks: string[] = []
	result = result.replace(/`([^`]+)`/g, (_, code: string) => {
		codeChunks.push(`<code>${code}</code>`)
		return `\x00CODE${codeChunks.length - 1}\x00`
	})

	// Links [text](url) — must come before bold/italic to avoid * in URLs.
	result = result.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, linkText: string, url: string) => {
		return `<a href="${escapeAttr(url)}" rel="noopener noreferrer">${linkText}</a>`
	})

	// Bold **text**
	result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")

	// Italic *text* (after bold to avoid consuming ** markers)
	result = result.replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")

	// Strikethrough ~~text~~
	result = result.replace(/~~([^~]+)~~/g, "<del>$1</del>")

	// Restore inline code — \x00 is a null-byte sentinel inserted during code chunk extraction.
	// eslint-disable-next-line no-control-regex -- intentional null-byte sentinels for code-chunk round-tripping
	result = result.replace(/\x00CODE(\d+)\x00/g, (_, idx: string) => codeChunks[parseInt(idx, 10)] || "")

	return result
}

// ---------------------------------------------------------------------------
// Block-level helpers
// ---------------------------------------------------------------------------

/** Check if a line starts a block-level element. */
function isBlockStart(line: string): boolean {
	const trimmed = line.trim()
	return (
		trimmed.startsWith("```") ||
		/^#{1,6}\s/.test(line) ||
		/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed) ||
		/^>\s?/.test(line) ||
		/^[-*]\s+/.test(line) ||
		/^\d+\.\s+/.test(line)
	)
}

// ---------------------------------------------------------------------------
// Main markdown renderer
// ---------------------------------------------------------------------------

/**
 * Render spec markdown into sanitized HTML.
 *
 * Supports: ATX headings, bold, italic, strikethrough, inline code, code
 * blocks (with mermaid detection), unordered/ordered lists, task lists,
 * tables, blockquotes, horizontal rules, links, and paragraphs.
 *
 * Mermaid code blocks (` ```mermaid `) are replaced with
 * `<div class="mermaid-slot" data-mermaid="<encoded>">` placeholders.
 *
 * @param md - Raw markdown string. Empty/null returns "".
 * @returns Sanitized HTML string safe for `innerHTML`.
 */
export function renderSpecMarkdown(md: string): string {
	if (!md || typeof md !== "string") return ""

	const truncated = md.length > PREVIEW_MAX_CHARS
	if (truncated) {
		md = md.slice(0, PREVIEW_MAX_CHARS)
	}

	const lines = md.split("\n")
	const blocks: string[] = []
	let i = 0

	while (i < lines.length) {
		const line = lines[i]
		const trimmed = line.trim()

		// --- Code fence ---
		if (trimmed.startsWith("```")) {
			const lang = trimmed.slice(3).trim()
			const codeLines: string[] = []
			i++
			while (i < lines.length && !lines[i].trim().startsWith("```")) {
				codeLines.push(lines[i])
				i++
			}
			i++ // skip closing fence

			const code = codeLines.join("\n")

			if (lang.toLowerCase() === "mermaid") {
				blocks.push(`<div class="mermaid-slot" data-mermaid="${encodeURIComponent(code)}"></div>`)
			} else {
				const langClass = lang ? ` class="language-${escapeAttr(lang)}"` : ""
				blocks.push(`<pre><code${langClass}>${escapeHtml(code)}</code></pre>`)
			}
			continue
		}

		// --- Heading ---
		const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
		if (headingMatch) {
			const level = headingMatch[1].length
			blocks.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`)
			i++
			continue
		}

		// --- Horizontal rule ---
		if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed) && trimmed.length >= 3) {
			blocks.push("<hr />")
			i++
			continue
		}

		// --- Blockquote ---
		if (/^>\s?/.test(line)) {
			const quoteLines: string[] = []
			while (i < lines.length && /^>\s?/.test(lines[i])) {
				quoteLines.push(lines[i].replace(/^>\s?/, ""))
				i++
			}
			blocks.push(`<blockquote>${renderInline(quoteLines.join(" "))}</blockquote>`)
			continue
		}

		// --- Table ---
		if (line.includes("|") && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
			const parseRow = (rowLine: string): string[] => {
				const cells = rowLine.split("|")
				// Remove first and last empty entries from leading/trailing |
				if (cells.length > 2 && cells[0].trim() === "") cells.shift()
				if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop()
				return cells.map((c) => c.trim())
			}

			const headerCells = parseRow(line)
			i += 2 // skip header + separator

			const rows: string[][] = []
			while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
				rows.push(parseRow(lines[i]))
				i++
			}

			const thead = `<thead><tr>${headerCells.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>`
			const tbody = `<tbody>${rows
				.map((row) => `<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`)
				.join("")}</tbody>`
			blocks.push(`<table>${thead}${tbody}</table>`)
			continue
		}

		// --- Task list item ---
		if (/^[-*]\s+\[[ xX]\]\s+/.test(line)) {
			const items: string[] = []
			while (i < lines.length && /^[-*]\s+\[[ xX]\]\s+/.test(lines[i])) {
				const checked = /\[[xX]\]/.test(lines[i])
				const text = lines[i].replace(/^[-*]\s+\[[ xX]\]\s+/, "")
				items.push(
					`<li class="task-list-item"><input type="checkbox"${
						checked ? " checked" : ""
					} disabled /> ${renderInline(text)}</li>`,
				)
				i++
			}
			blocks.push(`<ul class="task-list">${items.join("")}</ul>`)
			continue
		}

		// --- Unordered list ---
		if (/^[-*]\s+/.test(line)) {
			const items: string[] = []
			while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
				items.push(`<li>${renderInline(lines[i].replace(/^[-*]\s+/, ""))}</li>`)
				i++
			}
			blocks.push(`<ul>${items.join("")}</ul>`)
			continue
		}

		// --- Ordered list ---
		if (/^\d+\.\s+/.test(line)) {
			const items: string[] = []
			while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
				items.push(`<li>${renderInline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`)
				i++
			}
			blocks.push(`<ol>${items.join("")}</ol>`)
			continue
		}

		// --- Empty line ---
		if (trimmed === "") {
			i++
			continue
		}

		// --- Paragraph (collect consecutive non-block lines) ---
		const paraLines: string[] = []
		while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
			paraLines.push(lines[i])
			i++
		}
		if (paraLines.length > 0) {
			blocks.push(`<p>${renderInline(paraLines.join(" "))}</p>`)
		}
	}

	let html = blocks.join("\n")

	if (truncated) {
		html +=
			'<p class="preview-truncated">⚠ Preview truncated — document exceeds 100 KB. Switch to Edit mode for full content.</p>'
	}

	return sanitizePreviewHtml(html)
}
