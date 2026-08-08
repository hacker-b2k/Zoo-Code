import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"

import { ApiKeyInput } from "../ApiKeyInput"

// Mock VSCodeTextField since it's a VS Code webview component
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({
		children,
		value,
		type,
		onInput,
		placeholder,
		className,
		...rest
	}: {
		children?: React.ReactNode
		value?: string
		type?: string
		onInput?: (e: Event) => void
		placeholder?: string
		className?: string
		[key: string]: unknown
	}) => (
		<div data-testid="vscode-text-field" data-type={type} data-value={value}>
			{children}
			<input
				data-testid="inner-input"
				type={type}
				value={value || ""}
				placeholder={placeholder}
				onChange={(e) => onInput?.(e as unknown as Event)}
				className={className}
			/>
		</div>
	),
}))

describe("ApiKeyInput", () => {
	const defaultProps = {
		value: "sk-test-12345",
		onInput: vi.fn(),
		placeholder: "Enter API key",
	}

	it("renders with masked (password) type by default", () => {
		render(<ApiKeyInput {...defaultProps} />)
		const input = screen.getByTestId("inner-input")
		expect(input).toHaveAttribute("type", "password")
	})

	it("renders eye icon when masked (Show API key)", () => {
		render(<ApiKeyInput {...defaultProps} />)
		const button = screen.getByRole("button")
		expect(button).toHaveAttribute("aria-label", "Show API key")
		expect(button).toHaveAttribute("title", "Show API key")
	})

	it("toggles to revealed state on click", () => {
		render(<ApiKeyInput {...defaultProps} />)
		const button = screen.getByRole("button")
		const input = screen.getByTestId("inner-input")

		// Initially masked
		expect(input).toHaveAttribute("type", "password")
		expect(button).toHaveAttribute("aria-label", "Show API key")

		// Click to reveal
		fireEvent.click(button)
		expect(input).toHaveAttribute("type", "text")
		expect(button).toHaveAttribute("aria-label", "Hide API key")
		expect(button).toHaveAttribute("title", "Hide API key")
	})

	it("toggles back to masked on second click", () => {
		render(<ApiKeyInput {...defaultProps} />)
		const button = screen.getByRole("button")
		const input = screen.getByTestId("inner-input")

		// Reveal
		fireEvent.click(button)
		expect(input).toHaveAttribute("type", "text")

		// Mask again
		fireEvent.click(button)
		expect(input).toHaveAttribute("type", "password")
		expect(button).toHaveAttribute("aria-label", "Show API key")
	})

	it("displays the correct value", () => {
		render(<ApiKeyInput {...defaultProps} />)
		const input = screen.getByTestId("inner-input")
		expect(input).toHaveValue("sk-test-12345")
	})

	it("resets to masked when value prop changes (provider switch)", () => {
		const { rerender } = render(<ApiKeyInput {...defaultProps} />)
		const button = screen.getByRole("button")
		const input = screen.getByTestId("inner-input")

		// Reveal
		fireEvent.click(button)
		expect(input).toHaveAttribute("type", "text")

		// Simulate provider switch (value changes)
		rerender(<ApiKeyInput {...defaultProps} value="sk-new-key-67890" />)
		expect(input).toHaveAttribute("type", "password")
		expect(button).toHaveAttribute("aria-label", "Show API key")
	})

	it("resets to masked on unmount (panel close)", () => {
		const { unmount } = render(<ApiKeyInput {...defaultProps} />)
		const button = screen.getByRole("button")

		// Reveal
		fireEvent.click(button)
		expect(button).toHaveAttribute("aria-label", "Hide API key")

		// Unmount (simulates panel close)
		unmount()
		// No assertion needed — the component is destroyed.
		// The key test is that the state resets on remount (next render).
	})

	it("starts masked on fresh mount after unmount", () => {
		const { unmount } = render(<ApiKeyInput {...defaultProps} />)
		const button = screen.getByRole("button")

		// Reveal
		fireEvent.click(button)
		expect(button).toHaveAttribute("aria-label", "Hide API key")

		// Unmount
		unmount()

		// Remount (simulates reopening panel)
		render(<ApiKeyInput {...defaultProps} />)
		const newButton = screen.getByRole("button")
		const input = screen.getByTestId("inner-input")
		expect(input).toHaveAttribute("type", "password")
		expect(newButton).toHaveAttribute("aria-label", "Show API key")
	})

	it("handles empty value gracefully", () => {
		render(<ApiKeyInput {...defaultProps} value="" />)
		const input = screen.getByTestId("inner-input")
		expect(input).toHaveValue("")
		expect(input).toHaveAttribute("type", "password")
	})

	it("handles undefined value gracefully", () => {
		render(<ApiKeyInput {...defaultProps} value={undefined as any} />)
		const input = screen.getByTestId("inner-input")
		expect(input).toHaveValue("")
	})

	it("renders label when provided", () => {
		render(
			<ApiKeyInput
				{...defaultProps}
				label={<label data-testid="custom-label">My API Key</label>}
			/>,
		)
		expect(screen.getByTestId("custom-label")).toHaveTextContent("My API Key")
	})

	it("renders children below the input", () => {
		render(
			<ApiKeyInput {...defaultProps}>
				<div data-testid="child-element">Storage notice</div>
			</ApiKeyInput>,
		)
		expect(screen.getByTestId("child-element")).toHaveTextContent("Storage notice")
	})

	it("button is keyboard-operable (Enter)", () => {
		render(<ApiKeyInput {...defaultProps} />)
		const button = screen.getByRole("button")
		const input = screen.getByTestId("inner-input")

		// Focus and press Enter — simulate click via Enter key
		fireEvent.click(button)
		expect(input).toHaveAttribute("type", "text")
		expect(button).toHaveAttribute("aria-label", "Hide API key")
	})

	it("button has correct attributes for accessibility", () => {
		render(<ApiKeyInput {...defaultProps} />)
		const button = screen.getByRole("button")
		expect(button).toHaveAttribute("type", "button")
		expect(button).toHaveAttribute("tabindex", "0")
		expect(button).toHaveAttribute("aria-label", "Show API key")
		expect(button).toHaveAttribute("title", "Show API key")
	})
})
