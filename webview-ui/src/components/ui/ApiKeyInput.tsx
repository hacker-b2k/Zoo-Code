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
 * Uses VS Code codicons (codicon-eye / codicon-eye-closed) for guaranteed
 * rendering in the VS Code webview. Lucide icons may not render.
 *
 * Security: defaults to masked (password) state. Resets to masked when:
 * - Component unmounts (panel close / provider switch)
 * - The value prop changes (different key loaded)
 *
 * The toggle is purely display-layer — the actual stored/secret value
 * is never modified by this component.
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
		<div className={cn("apikey-input-wrapper", className)}>
			<div className="apikey-input-row" style={{ display: "flex", alignItems: "stretch", gap: "4px" }}>
				<div style={{ flex: 1 }}>
					<VSCodeTextField
						value={value || ""}
						type={revealed ? "text" : "password"}
						onInput={onInput}
						placeholder={placeholder}
						className="w-full"
						data-testid={testId}>
						{label}
					</VSCodeTextField>
				</div>
				<button
					type="button"
					tabIndex={0}
					onClick={toggleReveal}
					aria-label={revealed ? "Hide API key" : "Show API key"}
					title={revealed ? "Hide API key" : "Show API key"}
					className={cn(
						"flex items-center justify-center",
						"rounded-sm",
						"bg-transparent border-none",
						"text-vscode-descriptionForeground opacity-70",
						"hover:opacity-100 hover:bg-[rgba(255,255,255,0.05)]",
						"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
						"cursor-pointer",
						"transition-opacity duration-150",
					)}
					style={{ width: "28px", padding: 0 }}>
					<span
						className={cn(
							"codicon",
							revealed ? "codicon-eye-closed" : "codicon-eye",
						)}
						style={{ fontSize: "16px", lineHeight: 1 }}
					/>
				</button>
			</div>
			{children}
		</div>
	)
}
