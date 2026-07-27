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
})
