/** Shared tool-call protocol instructions. Tool use is conditional on turn intent. */
export function getSharedToolUseSection(mode: "native" | "dual" | "text" = "native"): string {
	const policy = `Turn policy:
- Conversational answers and explanations may be returned directly without tools.
- For actionable work, call the tool or tools needed to perform the request; describing the action is not a substitute.
- Use attempt_completion only to finalize completed actionable work. It is not required for conversation.
- Call independent, non-destructive tools in parallel when that has a clear benefit. Keep dependent, destructive, approval-gated, and MCP operations sequential.`

	if (mode === "text") {
		return `====

TOOL USE

You have access to tools. When a tool is needed, write it as structured text using this exact format:

<tool_call>
{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}
</tool_call>

Rules:
- Each textual tool call must be wrapped in <tool_call>...</tool_call> tags.
- The JSON must have "name" and "arguments" keys.
- Do not write code blocks as plain text when you intend to create or modify a file; call an editing tool.
- For actionable work, emit the required tool call rather than prose that merely promises the action.
${policy}`
	}

	if (mode === "dual") {
		return `====

TOOL USE

When a tool is needed, prefer the provider-native structured tool-calling mechanism. A structured-text fallback is also available:

<tool_call>
{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}
</tool_call>

Rules:
- Text-format calls must use <tool_call>...</tool_call> with "name" and "arguments".
- Do not write code blocks as plain text when you intend to create or modify a file; call an editing tool.
- For actionable work, emit the required structured tool call rather than prose that merely promises the action.
${policy}`
	}

	return `====

TOOL USE

When a tool is needed, invoke it through the provider-native structured tool-calling mechanism (the tool_calls / function-calling API). Never write an intended tool call as plain text, XML markup, or a JSON code block; shapes such as <tool_call>, <function=name>, <parameter=key>, and <invoke> are not native calls. Do not include textual tool-call examples in native mode. For actionable work, emit the required structured tool call rather than prose that merely promises the action.

${policy}`
}
