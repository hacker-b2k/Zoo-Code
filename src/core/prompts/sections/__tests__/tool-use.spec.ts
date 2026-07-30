import { getSharedToolUseSection } from "../tool-use"

describe("getSharedToolUseSection", () => {
	it("should include native tool-calling instructions", () => {
		const section = getSharedToolUseSection()

		expect(section).toContain("provider-native structured tool-calling mechanism")
		expect(section).toContain("Do not include XML markup or examples")
	})

	it("should explicitly prohibit textual/XML/JSON tool-call markup", () => {
		const section = getSharedToolUseSection()

		expect(section).toContain("NEVER write a tool call as plain text, XML markup, or a JSON block")
		expect(section).toContain("<tool_call>")
		expect(section).toContain("<function=name>")
		expect(section).toContain("NOT valid calls")
	})

	it("should include multiple tools per message guidance", () => {
		const section = getSharedToolUseSection()

		expect(section).toContain("You must call at least one tool per assistant response")
		expect(section).toContain("Prefer calling as many tools as are reasonably needed")
	})

	it("should NOT include single tool per message restriction", () => {
		const section = getSharedToolUseSection()

		expect(section).not.toContain("You must use exactly one tool call per assistant response")
		expect(section).not.toContain("Do not call zero tools or more than one tool")
	})

	it("should NOT include XML formatting instructions", () => {
		const section = getSharedToolUseSection()

		expect(section).not.toContain("<actual_tool_name>")
		expect(section).not.toContain("</actual_tool_name>")
	})

	// --- Dual mode (identity-confusion prevention) ---

	it("dual mode includes both native and text-based instructions", () => {
		const section = getSharedToolUseSection("dual")

		expect(section).toContain("provider-native structured tool-calling mechanism")
		expect(section).toContain("Structured text")
		expect(section).toContain(`{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}`)
	})

	it("dual mode does NOT reveal provider architecture (no identity confusion)", () => {
		const section = getSharedToolUseSection("dual")

		// Critical: saying "your provider does not support X" causes identity confusion
		expect(section).not.toContain("does not support")
		expect(section).not.toContain("may not support")
		expect(section).not.toContain("not fully support")
		expect(section).not.toContain("lacks")
	})

	it("text mode does NOT reveal provider architecture", () => {
		const section = getSharedToolUseSection("text")

		expect(section).not.toContain("Your provider does not support")
		expect(section).not.toContain("provider may not")
		expect(section).toContain("To invoke a tool, write it as structured text")
	})

	it("dual mode is the default for unknown providers", () => {
		// Default param (no arg) should be "native" for proven-native providers
		const nativeSection = getSharedToolUseSection()
		expect(nativeSection).toContain("provider-native structured tool-calling mechanism")
		expect(nativeSection).not.toContain("Structured text")
	})
})
