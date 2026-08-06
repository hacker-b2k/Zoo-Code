import { parseFollowUpData } from "../followup.js"

describe("parseFollowUpData", () => {
	it("validates legacy follow-up JSON before returning it to a renderer", () => {
		const result = parseFollowUpData('{"question":"Choose a path","suggest":[{"answer":"Initialize"}]}')

		expect(result).toEqual({
			valid: true,
			data: { question: "Choose a path", suggest: [{ answer: "Initialize" }] },
		})
	})

	it("converts flexible elicitation markup to safe suggestions", () => {
		const result = parseFollowUpData(`
			<ElicitationsGroup message='Select how to begin'>
				<Elicitation query="Create a scaffold" label="Scaffold" />
				<Elicitation label="Draft requirements" query="Write requirements"/>
			</ElicitationsGroup>
		`)

		expect(result).toEqual({
			valid: true,
			data: {
				question: "Select how to begin",
				suggest: [{ answer: "Create a scaffold" }, { answer: "Write requirements" }],
			},
		})
	})

	it("does not expose malformed elicitation markup as fallback text", () => {
		const result = parseFollowUpData('<ElicitationsGroup message="Missing close"><Elicitation label="Broken"/>')

		expect(result).toEqual({ valid: false, fallbackText: "" })
	})

	it("rejects invalid JSON shapes without passing them to React", () => {
		const result = parseFollowUpData('{"question":{},"suggest":{}}')

		expect(result).toEqual({ valid: false, fallbackText: '{"question":{},"suggest":{}}' })
	})
})
