import { render, screen } from "@testing-library/react"

import { Markdown } from "../Markdown"

// Mock the heavy MarkdownBlock renderer — this spec targets the prop
// normalization contract in the Markdown wrapper, not markdown parsing.
vi.mock("../../common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown: string }) => <div data-testid="markdown-block">{markdown}</div>,
}))

vi.mock("@src/utils/clipboard", () => ({
	useCopyToClipboard: () => ({ copyWithFeedback: vi.fn(), showCopyFeedback: false }),
}))

vi.mock("@src/components/ui", () => ({
	StandardTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe("Markdown", () => {
	it("renders string markdown normally", () => {
		render(<Markdown markdown="Hello **world**" />)
		expect(screen.getByTestId("markdown-block")).toHaveTextContent("Hello **world**")
	})

	it("renders nothing for empty/undefined markdown", () => {
		const { container } = render(<Markdown markdown={undefined} />)
		expect(container).toBeEmptyDOMElement()
	})

	it("coerces a non-string value instead of crashing with React error #31", () => {
		// An object reaching this component used to be rendered as a React child,
		// crashing the whole webview ("Objects are not valid as a React child").
		const objectValue = { some: "object" } as unknown as string
		render(<Markdown markdown={objectValue} />)
		expect(screen.getByTestId("markdown-block")).toHaveTextContent("[object Object]")
	})

	it("coerces numeric values to their string form", () => {
		render(<Markdown markdown={42 as unknown as string} />)
		expect(screen.getByTestId("markdown-block")).toHaveTextContent("42")
	})
})
