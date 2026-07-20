import React, { memo, useState, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, Code, Terminal, AlertTriangle, List, AlignLeft, Copy, Check } from "lucide-react"

import type { ClineMessage } from "@roo-code/types"
import type { CollapseDecision } from "@src/utils/messageSize"
import { getContentTypeBadge, getPreviewText, PREVIEW_LINES } from "@src/utils/messageSize"
import { cn } from "@src/lib/utils"
import { parseCommandAndOutput } from "./CommandExecution"

interface MessageCollapsePreviewProps {
	message: ClineMessage
	decision: CollapseDecision
	onExpand: () => void
	isCommandExecuting?: boolean
}

const badgeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
	code: Code,
	terminal: Terminal,
	"alert-triangle": AlertTriangle,
	list: List,
	"align-left": AlignLeft,
}

/**
 * Formats milliseconds as a human-readable duration string.
 * Examples: 1200 → "1.2s", 65000 → "1m 5s", 300 → "0.3s"
 */
function formatDuration(ms: number): string {
	if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`
	const totalSeconds = ms / 1000
	if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = Math.round(totalSeconds % 60)
	return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export const MessageCollapsePreview = memo(
	({ message, decision, onExpand, isCommandExecuting }: MessageCollapsePreviewProps) => {
		const { t } = useTranslation()
		const badge = getContentTypeBadge(decision.reason)
		const previewText = getPreviewText(message, PREVIEW_LINES)
		const moreLines = decision.lineCount - PREVIEW_LINES
		const IconComponent = badgeIcons[badge.icon] || AlignLeft

		// Detect terminal command messages for enhanced header.
		const isTerminalCommand = message.type === "ask" && message.ask === "command"

		// Derive exit code, timing, and failure state from persisted message.text.
		// Pure data-layer read — survives chat switches and extension reloads.
		const { commandText, exitCode, isFailed, executionTimeMs } = useMemo(() => {
			if (!isTerminalCommand)
				return { commandText: "", exitCode: undefined, isFailed: false, executionTimeMs: undefined }
			const parsed = parseCommandAndOutput(message.text)
			const code = parsed.exitCode
			const failed = code !== undefined && code !== 0
			// Compute duration from persisted start/end time markers (if available).
			let durationMs: number | undefined
			if (parsed.startTime !== undefined && parsed.endTime !== undefined) {
				durationMs = parsed.endTime - parsed.startTime
			}
			return { commandText: parsed.command.trim(), exitCode: code, isFailed: failed, executionTimeMs: durationMs }
		}, [isTerminalCommand, message.text])

		// While the command is actively executing, show a running state with
		// pulsing indicator.  This is a live signal from ChatRow, not persisted.
		const isRunning = isTerminalCommand && isCommandExecuting === true

		// Copy-to-clipboard state for the Copy Command button.
		const [copyFeedback, setCopyFeedback] = useState(false)

		const handleCopyCommand = useCallback(
			async (e: React.MouseEvent) => {
				e.stopPropagation()
				if (!commandText) return
				try {
					await navigator.clipboard.writeText(commandText)
					setCopyFeedback(true)
					setTimeout(() => setCopyFeedback(false), 2000)
				} catch {
					// Silently ignore clipboard errors.
				}
			},
			[commandText],
		)

		const handleKeyDown = (e: React.KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault()
				onExpand()
			}
		}

		const hasExited = !isRunning && exitCode !== undefined
		const commandSucceeded = hasExited && exitCode === 0

		return (
			<div
				className={cn(
					"cursor-pointer rounded-md border bg-vscode-editor-background/50 hover:bg-vscode-editor-background/70 transition-colors",
					isFailed
						? "border-red-500/40"
						: isRunning
							? "border-yellow-500/30"
							: "border-vscode-widget-border/30",
				)}
				tabIndex={0}
				role="button"
				aria-label={t("chat:autoCollapse.ariaLabel", { reason: badge.label, count: decision.lineCount })}
				onClick={onExpand}
				onKeyDown={handleKeyDown}>
				{/* Header */}
				{isTerminalCommand ? (
					<div className="flex items-center gap-2 px-3 py-2">
						{isRunning ? (
							<div className="size-3.5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
						) : (
							<Terminal
								className={cn(
									"size-3.5",
									isFailed
										? "text-red-400"
										: commandSucceeded
											? "text-green-400"
											: "text-vscode-descriptionForeground",
								)}
							/>
						)}
						<span
							className={cn(
								"text-xs font-medium",
								isFailed
									? "text-red-400"
									: isRunning
										? "text-yellow-400"
										: commandSucceeded
											? "text-green-400"
											: "text-vscode-descriptionForeground",
							)}>
							{isRunning
								? t("chat:commandExecution.running")
								: isFailed
									? t("chat:commandExecution.failed")
									: commandSucceeded
										? t("chat:commandExecution.completed")
										: t("chat:autoCollapse.terminalOutput")}
						</span>
						{isFailed && exitCode !== undefined && (
							<div
								className="rounded-full size-1.5 bg-red-500"
								title={t("chat:commandExecution.exitStatus", { exitCode })}
							/>
						)}
						<span
							className={cn(
								"text-xs flex items-center gap-2",
								isFailed
									? "text-red-400/70"
									: isRunning
										? "text-yellow-400/70"
										: "text-vscode-descriptionForeground",
							)}>
							{isRunning ? (
								<span className="animate-pulse">{t("chat:commandExecution.running")}</span>
							) : executionTimeMs !== undefined ? (
								<span>{formatDuration(executionTimeMs)}</span>
							) : null}
							<span>{t("chat:autoCollapse.lineCount", { count: decision.lineCount })}</span>
						</span>
						<div className="ml-auto flex items-center gap-1">
							{commandText && (
								<button
									className="flex items-center gap-1 text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground transition-colors px-1 py-0.5 rounded cursor-pointer"
									onClick={handleCopyCommand}
									aria-label={t("chat:autoCollapse.copyCommand")}>
									{copyFeedback ? <Check className="size-3" /> : <Copy className="size-3" />}
									<span>
										{copyFeedback
											? t("chat:autoCollapse.copiedCommand")
											: t("chat:autoCollapse.copyCommand")}
									</span>
								</button>
							)}
							<ChevronDown className="size-3.5 text-vscode-descriptionForeground" />
						</div>
					</div>
				) : (
					<div className="flex items-center gap-2 px-3 py-2">
						<IconComponent className="size-3.5 text-vscode-descriptionForeground" />
						<span className="text-xs text-vscode-descriptionForeground font-medium">{badge.label}</span>
						<span className="text-xs text-vscode-descriptionForeground">
							{t("chat:autoCollapse.lineCount", { count: decision.lineCount })}
						</span>
						<div className="ml-auto">
							<ChevronDown className="size-3.5 text-vscode-descriptionForeground" />
						</div>
					</div>
				)}

				{/* Preview area */}
				<div className="relative overflow-hidden zoo-scrollbar" style={{ maxHeight: "80px" }}>
					<pre className="px-3 py-1 text-xs text-vscode-editor-foreground whitespace-pre-wrap break-words font-mono leading-relaxed">
						{previewText}
					</pre>
					<div
						className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
						style={{
							background: "linear-gradient(to bottom, transparent, var(--vscode-editor-background))",
						}}
					/>
				</div>

				{/* Footer */}
				<div className="flex items-center gap-1 px-3 py-1.5 border-t border-vscode-widget-border/20">
					<ChevronDown className="size-3 text-vscode-textLink-foreground" />
					<span className="text-xs text-vscode-textLink-foreground">
						{t("chat:autoCollapse.showMore", { count: moreLines })}
					</span>
				</div>
			</div>
		)
	},
)

MessageCollapsePreview.displayName = "MessageCollapsePreview"
