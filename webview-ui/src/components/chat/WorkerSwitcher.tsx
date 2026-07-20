import React, { useCallback, useMemo, useState } from "react"
import { Users, Check, ChevronDown } from "lucide-react"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@/components/ui"

/**
 * Chat toolbar control next to BRRR: switch UI focus among live multi-agent workers
 * without aborting the main task. Badge shows last focused worker ordinal (1-based).
 */
export const WorkerSwitcher = ({ triggerClassName = "" }: { triggerClassName?: string }) => {
	const [open, setOpen] = useState(false)
	const portalContainer = useRooPortal("roo-portal")
	const { orchestrationWorkers = [], lastFocusedWorkerId, currentTaskId } = useExtensionState()

	const sorted = useMemo(() => [...orchestrationWorkers].sort((a, b) => a.index - b.index), [orchestrationWorkers])

	const lastIndex = useMemo(() => {
		if (!lastFocusedWorkerId) {
			return sorted.length > 0 ? sorted[sorted.length - 1]?.index : undefined
		}
		return sorted.find((w) => w.workerId === lastFocusedWorkerId)?.index
	}, [lastFocusedWorkerId, sorted])

	const onSelectWorker = useCallback((workerId: string) => {
		// showTaskWithId focuses live workers without abort (ClineProvider).
		vscode.postMessage({ type: "showTaskWithId", text: workerId })
		setOpen(false)
	}, [])

	const onSelectMain = useCallback(() => {
		const parentId = sorted[0]?.parentTaskId
		if (parentId && parentId !== currentTaskId) {
			vscode.postMessage({ type: "showTaskWithId", text: parentId })
		}
		setOpen(false)
	}, [sorted, currentTaskId])

	if (sorted.length === 0) {
		return null
	}

	const badge = lastIndex ?? sorted.length

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<StandardTooltip content={`Workers (${sorted.length}) — switch without pausing main`}>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label={`Workers, last ${badge}`}
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
						<Users className="w-3.5 h-3.5 shrink-0" />
						<span className="text-[11px] font-semibold tabular-nums leading-none min-w-[0.75rem]">
							{badge}
						</span>
						<ChevronDown className="w-3 h-3 opacity-60" />
					</button>
				</PopoverTrigger>
			</StandardTooltip>
			<PopoverContent
				align="start"
				side="top"
				container={portalContainer}
				className="w-72 p-1 max-h-64 overflow-y-auto">
				<div className="px-2 py-1.5 text-[11px] uppercase tracking-wide opacity-60">Workers</div>
				{sorted[0]?.parentTaskId && (
					<button
						type="button"
						className={cn(
							"w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-sm",
							"hover:bg-vscode-list-hoverBackground",
							currentTaskId === sorted[0].parentTaskId && "bg-vscode-list-activeSelectionBackground",
						)}
						onClick={onSelectMain}>
						<span className="opacity-70 text-xs w-5 shrink-0">M</span>
						<span className="truncate flex-1">Main (control plane)</span>
						{currentTaskId === sorted[0].parentTaskId && <Check className="w-3.5 h-3.5 shrink-0" />}
					</button>
				)}
				{sorted.map((w) => {
					const active = currentTaskId === w.workerId
					return (
						<button
							key={w.workerId}
							type="button"
							className={cn(
								"w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-sm",
								"hover:bg-vscode-list-hoverBackground",
								active && "bg-vscode-list-activeSelectionBackground",
							)}
							onClick={() => onSelectWorker(w.workerId)}>
							<span className="font-semibold tabular-nums text-xs w-5 shrink-0">{w.index}</span>
							<span className="truncate flex-1" title={w.name}>
								{w.name}
							</span>
							<span className="text-[10px] opacity-60 shrink-0 max-w-[4.5rem] truncate" title={w.state}>
								{w.state}
							</span>
							{active && <Check className="w-3.5 h-3.5 shrink-0" />}
						</button>
					)
				})}
			</PopoverContent>
		</Popover>
	)
}
