import React, { useState, useCallback, useEffect } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { cn } from "@src/lib/utils"

interface ApiKeyInputProps {
	/** Current API key value */
	value: string
	/** Callback when value changes */
	onInput: (event: any) => void
	/** Placeholder text */
	placeholder?: string
	/** Label for the input */
	label?: React.ReactNode
	/** Additional class name for the wrapper */
	className?: string
	/** Data test ID */
	"data-testid"?: string
	/** Children to render below the input (e.g. storage notice) */
	children?: React.ReactNode
}

/**
 * Reusable API Key input with eye-icon visibility toggle.
 *
 * Uses VS Code codicons via `slot="end"` inside VSCodeTextField — the same
 * pattern used by HistoryView.tsx for the clear-search button. This places
 * the icon INSIDE the text field's shadow DOM, so height/alignment are
 * automatically correct.
 *
 * Security: defaults to masked (password) state. Resets to masked when:
 * - Component unmounts (panel close / provider switch)
 * - The value prop changes (different key loaded)
 */
export const ApiKeyInput = ({
	value,
	onInput,
	placeholder,
	label,
	className,
	"data-testid": testId,
	children,
}: ApiKeyInputProps) => {
	const [revealed, setRevealed] = useState(false)

	// Reset to masked when value changes (provider switch, new key loaded)
	useEffect(() => {
		setRevealed(false)
	}, [value])

	// Reset to masked on unmount (panel close, navigation away)
	useEffect(() => {
		return () => setRevealed(false)
	}, [])

	const toggleReveal = useCallback(() => {
		setRevealed((prev) => !prev)
	}, [])

	return (
		<div className={cn("w-full", className)}>
			<VSCodeTextField
				value={value || ""}
				type={revealed ? "text" : "password"}
				onInput={onInput}
				placeholder={placeholder}
				className="w-full"
				data-testid={testId}>
				{label}
				<div
					slot="end"
					className="input-icon-button codicon flex justify-center items-center"
					style={{ cursor: "pointer", opacity: 0.65 }}
					onClick={toggleReveal}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							toggleReveal()
						}
					}}
					tabIndex={0}
					role="button"
					aria-label={revealed ? "Hide API key" : "Show API key"}
					title={revealed ? "Hide API key" : "Show API key"}>
					<span
						className={cn(
							"codicon",
							revealed ? "codicon-eye-closed" : "codicon-eye",
						)}
						style={{ fontSize: "14px" }}
					/>
				</div>
			</VSCodeTextField>
			{children}
		</div>
	)
}
