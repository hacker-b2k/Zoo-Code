export function markdownFormattingSection(): string {
	return `====

MARKDOWN RULES

When a response references a specific file, use a clickable link [\`path\`](path) so users can open it directly. When naming a function/class/method in an explanation, prefer a clickable link with a line number when known, e.g. [\`myFunction()\`](src/file.ts:42). Plain technical prose does not need artificial links; do not invent file locations.`
}
