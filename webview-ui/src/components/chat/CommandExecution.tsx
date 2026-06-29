import { useCallback, useState, memo, useMemo } from "react"
import { useEvent } from "react-use"
import { t } from "i18next"
import { ChevronDown, Copy, Check, OctagonX, Terminal } from "lucide-react"

import { type ExtensionMessage, type CommandExecutionStatus, commandExecutionStatusSchema } from "@roo-code/types"

import { safeJsonParse } from "@roo/core"
import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"
import { parseCommand } from "@roo/parse-command"

import { vscode } from "@src/utils/vscode"
import { extractPatternsFromCommand } from "@src/utils/command-parser"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"

import { Button, StandardTooltip } from "@src/components/ui"
import CodeBlock from "@src/components/common/CodeBlock"

import { CommandPatternSelector } from "./CommandPatternSelector"
import { TerminalOutput } from "./TerminalOutput"

// Regex to match persisted markers embedded in command_output text by ExecuteCommandTool.
// The markers appear at the end of the output string in this order:
//   \n[__START_TIME__:<epoch_ms>]
//   \n[__END_TIME__:<epoch_ms>]
//   \n[__EXIT_CODE__:<N>]
// The last marker must match the end of the string ($).
const EXIT_CODE_MARKER = /\n\[__EXIT_CODE__:(-?\d+)\]$/
const END_TIME_MARKER = /\n\[__END_TIME__:(\d+)\]$/
const START_TIME_MARKER = /\n\[__START_TIME__:(\d+)\]$/

// Module-level cache of the most recent status for each executionId. Populated
// by every onMessage handler so that a CommandExecution component that mounts
// after the "started" event was already delivered can recover the status from
// the cache rather than staying stuck at null.
const statusCache = new Map<string, CommandExecutionStatus>()

// Module-level cache of execution timing (start/end timestamps) per executionId.
// Populated by onMessage handler so that MessageCollapsePreview can display
// execution duration even after CommandExecution unmounts (auto-collapse).
const executionTimingCache = new Map<string, { startTime: number; endTime?: number }>()

/**
 * Returns the execution duration in milliseconds for a given executionId,
 * or undefined if timing data is not available.
 */
export function getExecutionTime(executionId: string): number | undefined {
	const timing = executionTimingCache.get(executionId)
	if (!timing || timing.endTime === undefined) return undefined
	return timing.endTime - timing.startTime
}

/**
 * Parses a consolidated command message text into the original command and output.
 * The consolidated format is: `<command>\nOutput:\n<output>`.
 * If no `Output:` separator is found, the entire text is treated as the command.
 */
export function parseCommandAndOutput(text: string | undefined): {
	command: string
	output: string
	exitCode?: number
	startTime?: number
	endTime?: number
} {
	if (!text) {
		return { command: "", output: "" }
	}

	const index = text.indexOf(COMMAND_OUTPUT_STRING)

	if (index === -1) {
		return { command: text, output: "" }
	}

	let output = text.slice(index + COMMAND_OUTPUT_STRING.length)
	let exitCode: number | undefined
	let startTime: number | undefined
	let endTime: number | undefined

	// Strip persisted markers from the end of the output (in reverse order).
	// ExecuteCommandTool onCompleted appends them as:
	//   \n[__START_TIME__:<epoch_ms>]
	//   \n[__END_TIME__:<epoch_ms>]
	//   \n[__EXIT_CODE__:<N>]
	// Each marker is stripped from the displayed output so the user sees clean text.
	const exitMatch = output.match(EXIT_CODE_MARKER)
	if (exitMatch) {
		output = output.slice(0, -exitMatch[0].length)
		exitCode = parseInt(exitMatch[1]!, 10)
	}

	const endMatch = output.match(END_TIME_MARKER)
	if (endMatch) {
		output = output.slice(0, -endMatch[0].length)
		endTime = parseInt(endMatch[1]!, 10)
	}

	const startMatch = output.match(START_TIME_MARKER)
	if (startMatch) {
		output = output.slice(0, -startMatch[0].length)
		startTime = parseInt(startMatch[1]!, 10)
	}

	return {
		command: text.slice(0, index),
		output,
		exitCode,
		startTime,
		endTime,
	}
}

interface CommandPattern {
	pattern: string
	description?: string
}

interface CommandExecutionProps {
	executionId: string
	text?: string
	icon?: JSX.Element | null
	title?: JSX.Element | null
}

export const CommandExecution = ({ executionId, text, icon, title }: CommandExecutionProps) => {
	const {
		terminalShellIntegrationDisabled = false,
		allowedCommands = [],
		deniedCommands = [],
		setAllowedCommands,
		setDeniedCommands,
	} = useExtensionState()

	const {
		command,
		output: parsedOutput,
		exitCode: persistedExitCode,
	} = useMemo(() => parseCommandAndOutput(text), [text])

	// If we aren't opening the VSCode terminal for this command then we default
	// to expanding the command execution output.
	const [isExpanded, setIsExpanded] = useState(terminalShellIntegrationDisabled)
	const [streamingOutput, setStreamingOutput] = useState("")
	// Initialize from the module-level cache so that components mounting after
	// the "started" event was delivered still show the running indicator.
	const [status, setStatus] = useState<CommandExecutionStatus | null>(() => statusCache.get(executionId) ?? null)

	// The command's output can either come from the text associated with the
	// task message (this is the case for completed commands) or from the
	// streaming output (this is the case for running commands).
	const output = streamingOutput || parsedOutput

	const isFailed =
		status?.status === "error" ||
		status?.status === "timeout" ||
		(status?.status === "exited" && status.exitCode !== 0) ||
		// Fallback to persisted exit code when live status is unavailable
		// (e.g. after chat switch and remount).
		(status === null && persistedExitCode !== undefined && persistedExitCode !== 0)

	// Extract command patterns from the actual command that was executed
	const commandPatterns = useMemo<CommandPattern[]>(() => {
		// First get all individual commands (including subshell commands) using parseCommand
		const { commands: allCommands } = parseCommand(command)

		// Then extract patterns from each command using the existing pattern extraction logic
		const allPatterns = new Set<string>()

		// Add all individual commands first. Multi-line patterns (e.g. heredocs,
		// unterminated quotes) are opaque tokens and must not be added verbatim --
		// their body lines would surface as approvable patterns. Only add
		// single-line commands; multi-line tokens are covered by pattern extraction.
		allCommands.forEach((cmd) => {
			if (cmd.trim() && !cmd.includes("\n")) {
				allPatterns.add(cmd.trim())
			}
		})

		// Then add extracted patterns for each command
		allCommands.forEach((cmd) => {
			const patterns = extractPatternsFromCommand(cmd)
			patterns.forEach((pattern) => allPatterns.add(pattern))
		})

		return Array.from(allPatterns).map((pattern) => ({
			pattern,
		}))
	}, [command])

	// Handle pattern changes
	const handleAllowPatternChange = (pattern: string) => {
		const isAllowed = allowedCommands.includes(pattern)
		const newAllowed = isAllowed ? allowedCommands.filter((p) => p !== pattern) : [...allowedCommands, pattern]
		const newDenied = deniedCommands.filter((p) => p !== pattern)

		setAllowedCommands(newAllowed)
		setDeniedCommands(newDenied)

		vscode.postMessage({
			type: "updateSettings",
			updatedSettings: { allowedCommands: newAllowed, deniedCommands: newDenied },
		})
	}

	const handleDenyPatternChange = (pattern: string) => {
		const isDenied = deniedCommands.includes(pattern)
		const newDenied = isDenied ? deniedCommands.filter((p) => p !== pattern) : [...deniedCommands, pattern]
		const newAllowed = allowedCommands.filter((p) => p !== pattern)

		setAllowedCommands(newAllowed)
		setDeniedCommands(newDenied)

		vscode.postMessage({
			type: "updateSettings",
			updatedSettings: { allowedCommands: newAllowed, deniedCommands: newDenied },
		})
	}

	const onMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "commandExecutionStatus") {
				const result = commandExecutionStatusSchema.safeParse(safeJsonParse(message.text, {}))

				if (result.success) {
					const data = result.data

					if (data.executionId !== executionId) {
						return
					}

					switch (data.status) {
						case "started":
							// Cache the started status so a component that mounts
							// after this event (e.g. after auto-approval causes a
							// fast remount) can recover the running indicator.
							statusCache.set(executionId, data)
							setStatus(data)
							// Record execution start time for duration tracking.
							executionTimingCache.set(executionId, { startTime: Date.now() })
							break
						case "exited":
						case "error":
						case "timeout":
							// Terminal states clear the cache so a fresh component
							// mounting after execution ends does not inherit a stale
							// "started" entry and incorrectly show the pulse dot.
							// Map.delete on a missing key is a no-op, so duplicate
							// deletes (e.g. error followed by exited) are safe.
							statusCache.delete(executionId)
							setStatus(data)
							// Clear streaming output so the component switches to
							// parsedOutput (from persisted command_output text).
							// The streaming buffer is cumulative and can drift from
							// the final persisted output; using parsedOutput after
							// completion prevents stale or duplicated content.
							setStreamingOutput("")
							// Record execution end time for duration display.
							{
								const existing = executionTimingCache.get(executionId)
								if (existing) {
									existing.endTime = Date.now()
								}
							}
							break
						case "fallback":
							// Not a terminal state -- signals a mid-execution retry
							// via execa after a shell integration failure. A new
							// "started" event will follow, so leave the cache intact.
							setIsExpanded(true)
							break
						case "output":
							setStreamingOutput(data.output)
							break
						default:
							setStatus(data)
							break
					}
				}
			}
		},
		[executionId],
	)

	useEvent("message", onMessage)

	return (
		<>
			<div className="flex flex-row items-center justify-between gap-2 mb-1">
				<div className="flex flex-row items-center gap-2">
					{icon}
					{title}
					{status?.status === "started" && (
						<StandardTooltip content={t("chat:commandExecution.running")}>
							<div className="rounded-full size-2 bg-yellow-500 animate-pulse" />
						</StandardTooltip>
					)}
					{status?.status === "exited" && (
						<div className="flex flex-row items-center gap-2 font-mono text-xs">
							<StandardTooltip
								content={t("chat.commandExecution.exitStatus", { exitStatus: status.exitCode })}>
								<div
									className={cn(
										"rounded-full size-2",
										status.exitCode === 0 ? "bg-green-600" : "bg-red-600",
									)}
								/>
							</StandardTooltip>
						</div>
					)}
					{status?.status === "error" && (
						<div className="flex flex-row items-center gap-2 font-mono text-xs text-vscode-errorForeground">
							<StandardTooltip content={status.message ?? t("chat:commandExecution.malformedCommand")}>
								<div className="rounded-full size-2 bg-red-600" />
							</StandardTooltip>
						</div>
					)}
					{/* Persisted exit code indicator — visible after remount (e.g. chat switch)
					    when live status is no longer available but the exit code was embedded
					    in the persisted command_output text by the backend. */}
					{status === null && persistedExitCode !== undefined && (
						<div className="flex flex-row items-center gap-2 font-mono text-xs">
							<StandardTooltip
								content={t("chat.commandExecution.exitStatus", { exitStatus: persistedExitCode })}>
								<div
									className={cn(
										"rounded-full size-2",
										persistedExitCode === 0 ? "bg-green-600" : "bg-red-600",
									)}
								/>
							</StandardTooltip>
						</div>
					)}
				</div>
				<div className=" flex flex-row items-center justify-between gap-2 px-1">
					<div className="flex flex-row items-center gap-1">
						{status?.status === "started" && (
							<div className="flex flex-row items-center gap-2 font-mono text-xs">
								{status.pid && <div className="whitespace-nowrap">(PID: {status.pid})</div>}
								<StandardTooltip content={t("chat:commandExecution.abort")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() =>
											vscode.postMessage({
												type: "terminalOperation",
												terminalOperation: "abort",
											})
										}>
										<OctagonX className="size-4" />
									</Button>
								</StandardTooltip>
							</div>
						)}
						{output.length > 0 && (
							<Button variant="ghost" size="icon" onClick={() => setIsExpanded(!isExpanded)}>
								<ChevronDown
									className={cn(
										"size-4 transition-transform duration-300",
										isExpanded && "rotate-180",
									)}
								/>
							</Button>
						)}
					</div>
				</div>
			</div>

			<div
				className={cn(
					"bg-vscode-editor-background border rounded-md ml-6 mt-2",
					isFailed ? "border-red-500/30" : "border-vscode-border",
				)}>
				<div className="p-2">
					<CodeBlock source={command} language="shell" />
					<OutputContainer isExpanded={isExpanded} output={output} command={command} isFailed={isFailed} />
				</div>
				{command && command.trim() && (
					<CommandPatternSelector
						patterns={commandPatterns}
						allowedCommands={allowedCommands}
						deniedCommands={deniedCommands}
						onAllowPatternChange={handleAllowPatternChange}
						onDenyPatternChange={handleDenyPatternChange}
					/>
				)}
			</div>
		</>
	)
}

CommandExecution.displayName = "CommandExecution"

const OutputContainerInternal = ({
	isExpanded,
	output,
	command,
	isFailed,
}: {
	isExpanded: boolean
	output: string
	command: string
	isFailed: boolean
}) => {
	const [copyFeedback, setCopyFeedback] = useState(false)

	const handleCopyOutput = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation()
			if (!output) return
			try {
				await navigator.clipboard.writeText(output)
				setCopyFeedback(true)
				setTimeout(() => setCopyFeedback(false), 2000)
			} catch {
				// Silently ignore clipboard errors.
			}
		},
		[output],
	)

	const lineCount = output ? output.split("\n").length : 0

	return (
		<div
			className={cn("zoo-scrollbar", {
				"max-h-0 overflow-hidden": !isExpanded,
				"max-h-[100px] overflow-y-auto mt-1 pt-1 border-t border-border/25": isExpanded && !isFailed,
				"max-h-[100px] overflow-y-auto mt-1 pt-1 border-t border-red-500/40": isExpanded && isFailed,
			})}>
			{output.length > 0 && (
				<>
					<div className="flex items-center gap-2 px-2 py-1 sticky top-0 z-10 bg-vscode-editor-background">
						<Terminal
							className={cn(
								"size-3.5",
								isFailed ? "text-vscode-errorForeground" : "text-vscode-descriptionForeground",
							)}
						/>
						<span
							className={cn(
								"text-xs font-medium",
								isFailed ? "text-vscode-errorForeground" : "text-vscode-descriptionForeground",
							)}>
							{t("chat:autoCollapse.terminalOutput")}
						</span>
						<span
							className={cn(
								"text-xs",
								isFailed
									? "text-vscode-errorForeground opacity-70"
									: "text-vscode-descriptionForeground",
							)}>
							{t("chat:autoCollapse.lineCount", { count: lineCount })}
						</span>
						<div className="ml-auto">
							<button
								className={cn(
									"flex items-center gap-1 text-xs transition-colors px-1 py-0.5 rounded cursor-pointer",
									isFailed
										? "text-vscode-errorForeground hover:opacity-80"
										: "text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground",
								)}
								onClick={handleCopyOutput}
								aria-label={t("chat:autoCollapse.copyOutput")}>
								{copyFeedback ? <Check className="size-3" /> : <Copy className="size-3" />}
								<span>
									{copyFeedback
										? t("chat:autoCollapse.copiedOutput")
										: t("chat:autoCollapse.copyOutput")}
								</span>
							</button>
						</div>
					</div>
					<TerminalOutput content={output} />
				</>
			)}
		</div>
	)
}

const OutputContainer = memo(OutputContainerInternal)
