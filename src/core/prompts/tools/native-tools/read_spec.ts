import type OpenAI from "openai"

const DESCRIPTION = `Read a virtual Spec document from extension storage (not project files).

Always pass both parameters. Use null for spec_id when falling back to last-opened / sole pack.

## Read full document
{ "spec_id": null, "doc": "design" }

## Read only headings (no body content)
{ "spec_id": null, "doc": "design", "mode": "headings" }

## List revision history
{ "spec_id": null, "doc": "design", "mode": "history" }

## Read a specific revision
{ "spec_id": null, "doc": "design", "revision": 3 }

doc: "requirements" | "design" | "tasks"
mode: "full" (default) | "headings" | "history"
revision: number (specific revision to read)`

export default {
	type: "function",
	function: {
		name: "read_spec",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				spec_id: {
					type: ["string", "null"],
					description:
						"Spec id from list_specs. Pass null to use last-opened UI selection or the only existing pack. Do not omit the key — use null if unknown.",
				},
				doc: {
					type: "string",
					description: 'Document kind: "requirements" | "design" | "tasks"',
				},
				mode: {
					type: ["string", "null"],
					description:
						'"full" (default) — returns full content. "headings" — returns only heading lines with line numbers. "history" — returns revision list.',
				},
				revision: {
					type: ["number", "null"],
					description:
						"Specific revision number to read. Returns that revision content. Requires doc to be set.",
				},
			},
			required: ["doc"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
