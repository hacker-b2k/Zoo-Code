/**
 * F-021: merge helpers for partial write_spec updates (append / section / search-replace).
 * Pure functions — no I/O.
 */

export type WriteSpecMode = "replace" | "append" | "upsert_section" | "search_replace"

export function normalizeWriteSpecMode(raw: unknown): WriteSpecMode {
	if (typeof raw !== "string") {
		return "replace"
	}
	const m = raw.trim().toLowerCase()
	if (m === "append" || m === "upsert_section" || m === "search_replace" || m === "replace") {
		return m
	}
	// Aliases agents may invent
	if (m === "patch" || m === "search-replace" || m === "searchreplace") {
		return "search_replace"
	}
	if (m === "section" || m === "update_section") {
		return "upsert_section"
	}
	return "replace"
}

export function applyAppend(existing: string, chunk: string): string {
	const a = existing ?? ""
	const b = chunk ?? ""
	if (!a.trim()) {
		return b
	}
	if (!b.trim()) {
		return a
	}
	const needsNl = !a.endsWith("\n")
	return a + (needsNl ? "\n\n" : "\n") + b.replace(/^\n+/, "")
}

/**
 * Replace or insert a markdown section starting at a heading line that equals or starts with sectionHeading.
 * Section ends at the next heading of same or higher level (fewer #), or EOF.
 */
export function applyUpsertSection(existing: string, sectionHeading: string, newSectionBody: string): string {
	const heading = sectionHeading.trim()
	if (!heading) {
		throw new Error("section_heading is required for mode upsert_section")
	}
	const body = newSectionBody ?? ""
	const lines = (existing ?? "").split("\n")

	// Normalize: allow "## Foo" or "Foo"
	const headingKey = heading
		.replace(/^#+\s*/, "")
		.trim()
		.toLowerCase()

	let start = -1
	let startLevel = 2
	for (let i = 0; i < lines.length; i++) {
		const m = /^(#{1,6})\s+(.*)$/.exec(lines[i])
		if (!m) {
			continue
		}
		const title = m[2].trim().toLowerCase()
		if (title === headingKey || lines[i].trim().toLowerCase() === heading.trim().toLowerCase()) {
			start = i
			startLevel = m[1].length
			break
		}
	}

	const sectionText = ensureSectionStartsWithHeading(heading, body, startLevel)

	if (start < 0) {
		// Append new section
		return applyAppend(existing ?? "", sectionText)
	}

	let end = lines.length
	for (let j = start + 1; j < lines.length; j++) {
		const m = /^(#{1,6})\s+/.exec(lines[j])
		if (m && m[1].length <= startLevel) {
			end = j
			break
		}
	}

	const before = lines.slice(0, start).join("\n")
	const after = lines.slice(end).join("\n")
	const mid = sectionText.replace(/\n+$/, "")
	const parts = [before.replace(/\n+$/, ""), mid, after.replace(/^\n+/, "")].filter((p) => p.length > 0)
	return parts.join("\n\n") + (after ? "\n" : "")
}

function ensureSectionStartsWithHeading(heading: string, body: string, level: number): string {
	const hashes = "#".repeat(Math.min(6, Math.max(1, level)))
	const bare = heading.replace(/^#+\s*/, "").trim()
	const want = `${hashes} ${bare}`
	const t = (body ?? "").trim()
	if (!t) {
		return want + "\n"
	}
	if (/^#{1,6}\s+/.test(t.split("\n")[0] ?? "")) {
		return t
	}
	return want + "\n\n" + t
}

export function applySearchReplace(existing: string, oldString: string, newString: string, replaceAll = false): string {
	if (typeof oldString !== "string" || !oldString.length) {
		throw new Error("old_string is required and must be non-empty for mode search_replace")
	}
	if (typeof newString !== "string") {
		throw new Error("new_string is required for mode search_replace")
	}
	const src = existing ?? ""
	const count = src.split(oldString).length - 1
	if (count === 0) {
		throw new Error(
			`search_replace: old_string not found in document (${oldString.length} chars). ` +
				`Use read_spec first and match exact text including whitespace.`,
		)
	}
	if (!replaceAll && count > 1) {
		throw new Error(
			`search_replace: old_string matched ${count} times; pass replace_all: true or make old_string unique.`,
		)
	}
	if (replaceAll) {
		return src.split(oldString).join(newString)
	}
	const idx = src.indexOf(oldString)
	return src.slice(0, idx) + newString + src.slice(idx + oldString.length)
}

export function resolveWriteBody(params: {
	mode: WriteSpecMode
	existingContent: string
	content?: string
	sectionHeading?: string
	oldString?: string
	newString?: string
	replaceAll?: boolean
}): string {
	const { mode, existingContent } = params
	switch (mode) {
		case "replace":
			if (typeof params.content !== "string") {
				throw new Error("content is required for mode replace")
			}
			return params.content
		case "append":
			if (typeof params.content !== "string") {
				throw new Error("content is required for mode append")
			}
			return applyAppend(existingContent, params.content)
		case "upsert_section":
			if (typeof params.content !== "string") {
				throw new Error("content is required for mode upsert_section (section body)")
			}
			return applyUpsertSection(existingContent, params.sectionHeading ?? "", params.content)
		case "search_replace":
			return applySearchReplace(
				existingContent,
				params.oldString ?? "",
				params.newString ?? "",
				params.replaceAll === true,
			)
		default:
			return params.content ?? existingContent
	}
}
