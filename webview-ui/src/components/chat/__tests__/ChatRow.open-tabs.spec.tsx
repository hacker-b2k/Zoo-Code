import React from "react"
import { render } from "@/utils/test-utils"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"chat:directoryOperations.wantsToViewTopLevel": "Roo wants to view top level",
				"chat:directoryOperations.didViewTopLevel": "Roo viewed top level",
			}
			return translations[key] || key
		},
	}),
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => {
		return <>{children || i18nKey}</>
	},
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeBadge: ({ children, ...props }: { children: React.ReactNode }) => <span {...props}>{children}</span>,
}))

const queryClient = new QueryClient()
const mockOnToggleExpand = vi.fn()
const mockOnSuggestionClick = vi.fn()
const mockOnBatchFileResponse = vi.fn()
const mockOnFollowUpUnmount = vi.fn()

const renderChatRowWithProviders = (message: any, isExpanded = false) => {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={message}
					isExpanded={isExpanded}
					isLast={false}
					isStreaming={false}
					onToggleExpand={mockOnToggleExpand}
					onSuggestionClick={mockOnSuggestionClick}
					onBatchFileResponse={mockOnBatchFileResponse}
					onFollowUpUnmount={mockOnFollowUpUnmount}
					isFollowUpAnswered={false}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatRow - openTabs tool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should display openTabs ask message with header and browser info", () => {
		const message: any = {
			type: "ask",
			ask: "tool",
			ts: Date.now(),
			text: JSON.stringify({
				tool: "openTabs",
				browser: "chrome",
				openedCount: 2,
				urls: ["https://www.google.com", "https://github.com"],
				content: "https://www.google.com\nhttps://github.com",
			}),
			partial: false,
		}

		const { container, getByText } = renderChatRowWithProviders(message, true)

		expect(getByText("Wants to open browser tabs")).toBeInTheDocument()
		expect(container.textContent).toMatch(/chrome.*2 tabs/)
	})

	it("should display openTabs say message with header and browser info", () => {
		const message: any = {
			type: "say",
			say: "tool",
			ts: Date.now(),
			text: JSON.stringify({
				tool: "openTabs",
				browser: "edge",
				openedCount: 1,
				urls: ["https://example.com"],
				content: "https://example.com",
			}),
			partial: false,
		}

		const { container, getByText } = renderChatRowWithProviders(message, true)

		expect(getByText("Opened browser tabs")).toBeInTheDocument()
		expect(container.textContent).toMatch(/edge.*1 tabs/)
	})

	it("should render open tabs icon", () => {
		const message: any = {
			type: "ask",
			ask: "tool",
			ts: Date.now(),
			text: JSON.stringify({
				tool: "openTabs",
				browser: "auto",
				urls: ["https://test.com"],
				content: "https://test.com",
			}),
			partial: false,
		}

		const { container } = renderChatRowWithProviders(message, true)

		const icon = container.querySelector('[aria-label="Open tabs icon"]')
		expect(icon).toBeInTheDocument()
	})
})
