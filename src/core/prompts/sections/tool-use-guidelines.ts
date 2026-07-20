export function getToolUseGuidelinesSection(): string {
	return `# Tool Use Guidelines

1. Assess what information you already have and what information you need to proceed with the task.
2. Choose the most appropriate tool based on the task and the tool descriptions provided. Assess if you need additional information to proceed, and which of the available tools would be most effective for gathering this information. For example using the list_files tool is more effective than running a command like \`ls\` in the terminal. It's critical that you think about each available tool and use the one that best fits the current step in the task.
3. If multiple actions are needed, you may use multiple tools in a single message when appropriate, or use tools iteratively across messages. Each tool use should be informed by the results of previous tool uses. Do not assume the outcome of any tool use. Each step must be informed by the previous step's result.
4. **Provider / API key setup (Save ≠ Switch):** When the user already provided base URL, model id, and API key (and optionally named the protocol), call \`manage_provider_profile\` **once as the first tool** with action=upsert and settings+secrets. That tool **only saves** — it never activates the new profile (active provider stays unchanged so running agents keep working). Do **not** call list_provider_types, list_provider_profiles, list_files, read_file, update_todo_list, or ask_followup_question first. Unknown protocol → custom-endpoint + customEndpointFormat=custom. Named OpenAI-compatible → openai. Named Anthropic → anthropic. Named OpenRouter → openrouter. After save, stop unless the user explicitly asked to switch — then call \`activate_provider_profile\` on the saved name.

By carefully considering the user's response after tool executions, you can react accordingly and make informed decisions about how to proceed with the task. This iterative process helps ensure the overall success and accuracy of your work.`
}
