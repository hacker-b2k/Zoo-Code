/**
 * Shared tool-use instructions injected into the system prompt.
 *
 * @param textOnly When true, instructs the model to use structured text
 *   tool-call tags instead of provider-native function-calling — used when
 *   the provider is detected as lacking native tool support.
 */
export function getSharedToolUseSection(textOnly = false): string {
	if (textOnly) {
		return `====

TOOL USE (Text Mode)

Your provider does not support native tool calling. You MUST invoke tools by writing them as structured text in your response using this EXACT format:

<tool_call>
{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}
</tool_call>

Rules:
- Each tool call MUST be wrapped in <tool_call>...</tool_call> tags.
- The JSON inside MUST have "name" and "arguments" keys.
- You can include multiple tool calls in a single response.
- Do NOT write code blocks as plain text when you intend to create or modify a file — use write_to_file instead.
- For an actionable request, do not expose reasoning or planning before the tool call: emit only the required tool call(s).
- You must call at least one tool per assistant response.
- If you have completed the task, use attempt_completion.`
	}

	return `====

TOOL USE

You have access to a set of tools that are executed upon the user's approval. ALWAYS invoke tools through the provider-native structured tool-calling mechanism (the tool_calls / function-calling API). NEVER write a tool call as plain text, XML markup, or a JSON block inside your message content — shapes like <tool_call>...</tool_call>, <function=name>, <parameter=key>, <invoke name="...">, or a \`\`\`json block containing a tool invocation are NOT valid calls: they are not reliably executed and count as a failed response. Do not include XML markup or examples. For an actionable request, do not expose reasoning, planning, or an explanation as plain text before the tool call: emit only the required structured tool call(s). You must call at least one tool per assistant response. Prefer calling as many tools as are reasonably needed in a single response to reduce back-and-forth and complete tasks faster.`
}
