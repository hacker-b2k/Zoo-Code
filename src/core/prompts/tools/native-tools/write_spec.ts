import type OpenAI from "openai"

const DESCRIPTION = `Write a virtual Spec document in extension global storage (NOT the project tree — does not dirty git).

## Create a new Spec Workspace + write a doc
{
  "title": "Auth System",
  "spec_id": null,
  "doc": "design",
  "content": "# Design\\n\\n...",
  "mode": "replace"
}
- title: REQUIRED non-empty when creating
- spec_id: MUST be JSON null (not the string "null" or "None")
- doc: "requirements" | "design" | "tasks"
- mode: default "replace" (full body)

## Update existing (full replace)
{
  "title": "Auth System",
  "spec_id": "<id-from-list_specs>",
  "doc": "design",
  "content": "# Design\\n\\nfull body...",
  "mode": "replace"
}
- title: optional on update (pass existing name or omit with empty string "")

## Append section to large docs (F-021 — avoid token limits)
{
  "spec_id": "<id>",
  "title": "Auth System",
  "doc": "design",
  "mode": "append",
  "content": "## Data Model\\n\\n..."
}
Server loads current doc and appends. Use for multi-turn large designs.

## Upsert a markdown section by heading
{
  "spec_id": "<id>",
  "doc": "design",
  "mode": "upsert_section",
  "section_heading": "## Data Model",
  "content": "### Tables\\n\\n..."
}
Replaces that section if present, else appends it. title optional.

## Surgical edit (checkbox / one line) — DO NOT rewrite the whole doc
{
  "spec_id": "<id>",
  "doc": "tasks",
  "mode": "search_replace",
  "old_string": "- [ ] Ship login",
  "new_string": "- [x] Ship login",
  "replace_all": false
}
content may be omitted for search_replace. Prefer this for tiny edits.

Prefer write_spec over write_to_file for plans. Create while other packs exist: non-empty title + spec_id null. On failure: fix params and retry write_spec; never fall back to write_to_file / plans/*.md.`

export default {
	type: "function",
	function: {
		name: "write_spec",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				title: {
					type: ["string", "null"],
					description:
						"Pack title. REQUIRED non-empty when creating (spec_id null). On update may be null/empty — not used for rename unless you pass a new title intentionally.",
				},
				spec_id: {
					type: ["string", "null"],
					description:
						'Existing pack id from list_specs. JSON null to create. Do not pass the strings "null", "None", or "undefined".',
				},
				doc: {
					type: "string",
					description: 'Document: "requirements" | "design" | "tasks"',
				},
				content: {
					type: ["string", "null"],
					description:
						"Markdown body. Required for replace/append/upsert_section. Optional for search_replace.",
				},
				mode: {
					type: ["string", "null"],
					description:
						"replace (default full overwrite) | append | upsert_section | search_replace. Use search_replace for checkbox toggles; append/upsert_section for large multi-turn docs.",
				},
				section_heading: {
					type: ["string", "null"],
					description: 'For upsert_section: heading like "## Data Model"',
				},
				old_string: {
					type: ["string", "null"],
					description: "For search_replace: exact text to find",
				},
				new_string: {
					type: ["string", "null"],
					description: "For search_replace: replacement text",
				},
				replace_all: {
					type: ["boolean", "null"],
					description: "For search_replace: replace all matches (default false)",
				},
			},
			// Problem B root cause mitigation: marking all 9 keys as `required` with
			// `strict: true` forces MiMo (and any non-OpenAI gateway that tries to
			// honor strict mode) to emit literal `{}` for mode-irrelevant keys
			// (e.g. section_heading when mode=replace, old_string when mode=append),
			// producing silent "[object Object]" leakage or "arguments could not be
			// finalized (missing nativeArgs)" errors. Only `doc` is truly uniform
			// across every mode; every other param is mode-specific. With strict:
			// false (the gateway-safe default applied by convertToolsForOpenAI for
			// MiMo and other non-OpenAI gateways), trimming `required` lets models
			// omit irrelevant keys instead of substituting null/objects.
			required: ["doc"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
