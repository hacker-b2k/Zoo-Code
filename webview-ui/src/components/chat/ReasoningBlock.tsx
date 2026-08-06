import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@src/context/ExtensionStateContext"

import MarkdownBlock from "../common/MarkdownBlock"
import { Lightbulb, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Module-level cache that preserves the elapsed thinking time across
 * unmount/remount cycles caused by Virtuoso key changes.
 *
 * When a partial reasoning message transitions from a standalone Virtuoso item
 * to being wrapped inside a TaskActivityGroup, the Virtuoso item key format
 * changes (`${ts}-${index}` → `tag-${ts}-${index}`), causing React to unmount
 * the old ChatRow and mount a new TaskActivityGroup. This destroys the
 * ReasoningBlock's local state (elapsed timer).
 *
 * The cache is keyed by message timestamp and stores the final elapsed
 * milliseconds so a remounted ReasoningBlock can restore the display.
 */
const reasoningElapsedCache = new Map<number, number>()

interface ReasoningBlockProps {
	content: string
	ts: number
	isStreaming: boolean
	isLast: boolean
	metadata?: any
}

export const ReasoningBlock = ({ content, isStreaming, isLast, ts }: ReasoningBlockProps) => {
	const { t } = useTranslation()
	const { reasoningBlockCollapsed } = useExtensionState()

	const [isCollapsed, setIsCollapsed] = useState(reasoningBlockCollapsed)

	// Restore elapsed time from cache if this component remounted after a
	// Virtuoso key change (standalone → grouped transition).
	const cachedElapsed = reasoningElapsedCache.get(ts) ?? 0
	const startTimeRef = useRef<number>(Date.now() - cachedElapsed)
	const [elapsed, setElapsed] = useState<number>(cachedElapsed)
	const contentRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setIsCollapsed(reasoningBlockCollapsed)
	}, [reasoningBlockCollapsed])

	useEffect(() => {
		if (isLast && isStreaming) {
			const start = startTimeRef.current
			const tick = () => {
				const newElapsed = Date.now() - start
				setElapsed(newElapsed)
				reasoningElapsedCache.set(ts, newElapsed)
			}
			tick()
			const id = setInterval(tick, 1000)
			return () => {
				clearInterval(id)
				// Persist the final elapsed time so a remounted component can
				// restore the display instead of resetting to zero.
				reasoningElapsedCache.set(ts, Date.now() - start)
			}
		}
	}, [isLast, isStreaming, ts])

	const seconds = Math.floor(elapsed / 1000)
	const secondsLabel = t("chat:reasoning.seconds", { count: seconds })

	const handleToggle = () => {
		setIsCollapsed(!isCollapsed)
	}

	return (
		<div className="group">
			<div
				className="flex items-center justify-between mb-2.5 pr-2 cursor-pointer select-none"
				onClick={handleToggle}>
				<div className="flex items-center gap-2">
					<Lightbulb className="w-4" />
					<span className="font-bold text-vscode-foreground">{t("chat:reasoning.thinking")}</span>
					{elapsed > 0 && (
						<span className="text-sm text-vscode-descriptionForeground mt-0.5">{secondsLabel}</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<ChevronUp
						className={cn(
							"w-4 transition-all opacity-0 group-hover:opacity-100",
							isCollapsed && "-rotate-180",
						)}
					/>
				</div>
			</div>
			{(content?.trim()?.length ?? 0) > 0 && !isCollapsed && (
				<div
					ref={contentRef}
					className="border-l border-vscode-descriptionForeground/20 ml-2 pl-4 pb-1 text-vscode-descriptionForeground break-words">
					<MarkdownBlock markdown={content} />
				</div>
			)}
		</div>
	)
}
