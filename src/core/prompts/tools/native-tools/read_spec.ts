import type OpenAI from "openai"

const DESCRIPTION = `Read a virtual Spec document from extension storage (not project files).

Always pass both parameters. Use null for spec_id when falling back to last-opened / sole pack.

Example:
{ "spec_id": null, "doc": "design" }
{ "spec_id": "<id-from-list_specs>", "doc": "requirements" }

doc: "requirements" | "design" | "tasks"`

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
			},
			required: ["spec_id", "doc"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
