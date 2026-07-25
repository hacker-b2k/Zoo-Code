import type OpenAI from "openai"

const DESCRIPTION = `Delete virtual Spec Workspace pack(s) from extension storage only (never project files).

Removes pack metadata, documents, and revision history for the current VS Code workspace.
Prefer list_specs first. Use only when the user asks to delete.

Modes:
1) Single: { "spec_id": null } or { "spec_id": "<id>" }
2) Bulk ids: { "spec_ids": ["id1","id2",...] } — one confirmation for the whole batch
3) Explicit delete-all: { "delete_all": true } or filtered { "delete_all": true, "title_contains": "test" }

Never pass truncated display ids. Never delete project markdown.
Do not use delete_all unless the user explicitly asked to delete all / many matching packs.`

export default {
	type: "function",
	function: {
		name: "delete_spec",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				spec_id: {
					type: ["string", "null"],
					description:
						"Single pack id from list_specs. null = active/last-opened. Ignored when spec_ids or delete_all is set.",
				},
				spec_ids: {
					type: ["array", "null"],
					items: { type: "string" },
					description:
						"Bulk: full pack ids from list_specs. One approval for the entire list. Prefer this for multi-delete.",
				},
				delete_all: {
					type: ["boolean", "null"],
					description:
						"When true, delete all packs in this workspace (or filtered by title_contains). Only when user explicitly asked.",
				},
				title_contains: {
					type: ["string", "null"],
					description:
						'Optional filter with delete_all: case-insensitive substring on pack title (e.g. "test").',
				},
			},
			required: ["spec_id", "spec_ids", "delete_all", "title_contains"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
