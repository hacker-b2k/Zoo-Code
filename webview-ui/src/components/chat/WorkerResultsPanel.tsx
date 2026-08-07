import React, { useMemo, useState } from "react"
import { ClipboardList, ChevronDown, CheckCircle, XCircle, XOctagon, HelpCircle, RotateCcw, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@/components/ui"

/**
 * Chat toolbar control: shows completed/failed/cancelled worker results.
 * Appears next to the WorkerSwitcher. Badge shows count of results.
 * Clicking opens a popover with all results — the "panel".
 */
export const WorkerResultsPanel = ({ triggerClassName = "" }: { triggerClassName?: string }) => {
	const [open, setOpen] = useState(false)
	const portalContainer = useRooPortal("roo-portal")
	const { workerResults = [] } = useExtensionState()

	const sorted = useMemo(() => [...workerResults].sort((a, b) => b.ts - a.ts), [workerResults])

	if (sorted.length === 0) {
		return null
	}

	const completedCount = sorted.filter((r) => r.kind === "completed").length
	const failedCount = sorted.filter((r) => r.kind === "failed" || r.kind === "cancelled").length

	const getIcon = (kind: string) => {
		switch (kind) {
			case "completed":
				return <CheckCircle className="w-3 h-3 text-vscode-terminal-ansiGreen" />
			case "failed":
				return <XCircle className="w-3 h-3 text-vscode-terminal-ansiRed" />
			case "cancelled":
				return <XOctagon className="w-3 h-3 text-vscode-terminal-ansiYellow" />
			case "question":
				return <HelpCircle className="w-3 h-3 text-vscode-terminal-ansiCyan" />
			case "retrying":
				return <RotateCcw className="w-3 h-3 text-vscode-terminal-ansiYellow" />
			case "provider_switched":
				return <RefreshCw className="w-3 h-3 text-vscode-terminal-ansiMagenta" />
			default:
				return <CheckCircle className="w-3 h-3 opacity-50" />
		}
	}

	const getKindLabel = (kind: string) => {
		switch (kind) {
			case "completed":
				return "DONE"
			case "failed":
				return "FAIL"
			case "cancelled":
				return "STOP"
			case "question":
				return "ASK"
			case "review_digest":
				return "REVIEW"
			default:
				return kind.toUpperCase()
		}
	}

	const formatTime = (ts: number) => {
		const d = new Date(ts)
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
	}

	const truncate = (text: string, max: number) => {
		if (!text) return ""
		return text.length > max ? text.substring(0, max) + "..." : text
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<StandardTooltip content={`Worker Results (${sorted.length}) — ${completedCount} done, ${failedCount} failed`}>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label={`Worker Results, ${sorted.length} results`}
						className={cn(
							"relative inline-flex items-center justify-center gap-0.5",
							"bg-transparent border-none px-1.5 py-1",
							"rounded-md min-w-[28px] min-h-[28px]",
							"text-vscode-foreground opacity-85",
							"transition-all duration-150",
							"hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)]",
							"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
							"cursor-pointer",
							triggerClassName,
						)}>
						<ClipboardList className="w-3.5 h-3.5 shrink-0" />
						<span className="text-[11px] font-semibold tabular-nums leading-none min-w-[0.75rem]">
							{sorted.length}
						</span>
						<ChevronDown className="w-3 h-3 opacity-60" />
					</button>
				</PopoverTrigger>
			</StandardTooltip>
			<PopoverContent
				align="start"
				side="top"
				container={portalContainer}
				className="w-80 p-1 max-h-80 overflow-y-auto">
				<div className="px-2 py-1.5 text-[11px] uppercase tracking-wide opacity-60 flex items-center justify-between">
					<span>Worker Results</span>
					<span className="text-[10px] opacity-80">
						{completedCount} done · {failedCount} failed
					</span>
				</div>
				{sorted.map((r, i) => (
					<div
						key={`${r.workerId}-${i}`}
						className={cn(
							"w-full px-2 py-1.5 rounded-sm text-left",
							"border-b border-vscode-input-border last:border-b-0",
						)}>
						<div className="flex items-center gap-1.5 mb-0.5">
							{getIcon(r.kind)}
							<span className="font-semibold text-xs truncate flex-1" title={r.name}>
								{r.name}
							</span>
							<span
								className={cn(
									"text-[9px] font-mono px-1 py-0.5 rounded-sm",
									r.kind === "completed"
										? "bg-vscode-terminal-ansiGreen/15 text-vscode-terminal-ansiGreen"
										: r.kind === "failed"
											? "bg-vscode-terminal-ansiRed/15 text-vscode-terminal-ansiRed"
											: "bg-vscode-input-border/30 opacity-70",
								)}>
								{getKindLabel(r.kind)}
							</span>
							<span className="text-[10px] opacity-50 shrink-0">
								{formatTime(r.ts)}
							</span>
						</div>
						{r.summary && (
							<div className="text-[11px] opacity-70 pl-4.5 leading-snug whitespace-pre-wrap break-words">
								{truncate(r.summary, 200)}
							</div>
						)}
						<div className="flex items-center gap-2 mt-0.5 pl-4.5">
							{r.provider && (
								<span className="text-[9px] opacity-40">{r.provider}</span>
							)}
							{r.attempt > 1 && (
								<span className="text-[9px] opacity-40">attempt {r.attempt}</span>
							)}
						</div>
					</div>
				))}
			</PopoverContent>
		</Popover>
	)
}
