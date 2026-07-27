export function getSharedToolUseSection(): string {
	return `====

TOOL USE

You have access to a set of tools that are executed upon the user's approval. ALWAYS invoke tools through the provider-native structured tool-calling mechanism (the tool_calls / function-calling API). NEVER write a tool call as plain text, XML markup, or a JSON block inside your message content — shapes like <tool_call>...</tool_call>, <function=name>, <parameter=key>, <invoke name="...">, or a \`\`\`json block containing a tool invocation are NOT valid calls: they are not reliably executed and count as a failed response. Do not include XML markup or examples. You must call at least one tool per assistant response. Prefer calling as many tools as are reasonably needed in a single response to reduce back-and-forth and complete tasks faster.`
}
