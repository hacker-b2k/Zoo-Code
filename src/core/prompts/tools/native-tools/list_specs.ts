import type OpenAI from "openai"

const DESCRIPTION = `List virtual Spec Workspaces for the current project (extension storage only — does not create or list project files).

Use this instead of creating plan/blueprint .md files in the repository.
Returns id, title, stage, updatedAt for each spec pack.
Then use read_spec / write_spec with spec_id.`

export default {
	type: "function",
	function: {
		name: "list_specs",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {},
			required: [],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
