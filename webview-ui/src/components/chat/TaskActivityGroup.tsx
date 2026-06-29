import { memo, useMemo } from "react"
import { ChevronDown, ChevronRight, Activity } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ClineMessage, SuggestionItem, CompletionCheckpoint } from "@roo-code/types"
import type { CollapseDecision } from "@src/utils/messageSize"
import { cn } from "@/lib/utils"

import { ChatRowContent } from "./ChatRow"

export interface TaskActivityGroupProps {
	/** The messages contained in this group */
	messages: ClineMessage[]
	/** Whether the group is currently collapsed */
	isCollapsed: boolean
	/** Callback to toggle collapse state */
	onToggleCollapse: () => void

	// Collapse-decisions map for per-message auto-collapse within the group
	collapseDecisions: Map<number, { isExpanded: boolean; collapseDecision: CollapseDecision | null }>

	// Pass-through props for each ChatRowContent
	lastModifiedMessage?: ClineMessage
	isStreamingForContent: boolean
	/** Whether this group is the last Virtuoso item in the list */
	isLastInList: boolean
	onToggleExpand: (ts: number) => void
	onSuggestionClick?: (suggestion: SuggestionItem, event?: React.MouseEvent) => void
	onBatchFileResponse?: (response: { [key: string]: boolean }) => void
	onFollowUpUnmount?: () => void
	isFollowUpAutoApprovalPaused?: boolean
	enableButtons: boolean
	primaryButtonText?: string
	hasCheckpoint: boolean
	completionCheckpoint?: CompletionCheckpoint
	completionResultTs?: number
	onJumpToPreviousCheckpoint?: () => void
}

/**
 * Generate a short human-readable summary for the last message in a group.
 * Used in the collapsed view to show what the agent was last doing.
 */
function getLastActivityText(msg: ClineMessage): string {
	if (msg.type === "ask") {
		return msg.ask === "tool" ? "Tool request" : msg.ask === "command" ? "Command" : "Question"
	}
	// msg.type === "say"
	switch (msg.say) {
		case "text":
			return "Response"
		case "api_req_started":
			return "API request"
		case "api_req_retry_delayed":
			return "Retrying"
		case "reasoning":
			return "Thinking"
		case "condense_context":
			return "Condensing context"
		case "codebase_search_result":
			return "Codebase search"
		case "tool":
			return "Tool result"
		default:
			return msg.say ? msg.say.replace(/_/g, " ") : "Activity"
	}
}

/**
 * TaskActivityGroup renders a collapsible summary bar for a group of
 * intermediate agent messages. When expanded, it renders each contained
 * message using ChatRowContent. When collapsed, it shows a compact
 * summary bar with step count and last activity.
 *
 * The collapse state is fully controlled by the parent via `isCollapsed`.
 * The user always has manual control — no streaming guard overrides collapse.
 */
const TaskActivityGroup = memo(
	({
		messages,
		isCollapsed,
		onToggleCollapse,
		collapseDecisions,
		lastModifiedMessage,
		isStreamingForContent,
		isLastInList,
		onToggleExpand,
		onSuggestionClick,
		onBatchFileResponse,
		onFollowUpUnmount,
		isFollowUpAutoApprovalPaused,
		enableButtons,
		primaryButtonText,
		hasCheckpoint,
		completionCheckpoint,
		completionResultTs,
		onJumpToPreviousCheckpoint,
	}: TaskActivityGroupProps) => {
		const { t } = useTranslation()

		const effectivelyCollapsed = isCollapsed

		const stepCount = messages.length
		const lastMessage = messages[messages.length - 1]
		const lastActivity = useMemo(() => getLastActivityText(lastMessage), [lastMessage])

		return (
			<div
				className={cn(
					"border-l-2 border-vscode-textLink-foreground/30 rounded-sm my-1",
					"bg-vscode-textLink-foreground/[0.03]",
				)}>
				{/* Summary bar — always visible, click to toggle */}
				<button
					onClick={onToggleCollapse}
					className={cn(
						"flex items-center gap-2 w-full px-3 py-2 text-left",
						"hover:bg-vscode-textLink-foreground/[0.06] transition-colors",
						"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
					)}
					aria-expanded={!effectivelyCollapsed}
					aria-label={
						effectivelyCollapsed
							? t("chat:taskActivity.expand", { count: stepCount })
							: t("chat:taskActivity.collapse", { count: stepCount })
					}>
					{effectivelyCollapsed ? (
						<ChevronRight className="size-3.5 shrink-0 text-vscode-descriptionForeground" />
					) : (
						<ChevronDown className="size-3.5 shrink-0 text-vscode-descriptionForeground" />
					)}
					<Activity className="size-3.5 shrink-0 text-vscode-textLink-foreground" />
					<span className="text-xs font-medium text-vscode-foreground">{t("chat:taskActivity.label")}</span>
					<span className="text-xs text-vscode-descriptionForeground">
						— {t("chat:taskActivity.stepCount", { count: stepCount })}
					</span>
					{effectivelyCollapsed && lastActivity && (
						<span className="text-xs text-vscode-descriptionForeground truncate ml-auto">
							{t("chat:taskActivity.lastActivity", { activity: lastActivity })}
						</span>
					)}
				</button>

				{/* Expanded content — each contained message rendered via ChatRowContent */}
				{!effectivelyCollapsed && (
					<div className="px-[15px] py-[2px]">
						{messages.map((msg, msgIdx) => {
							const decision = collapseDecisions.get(msg.ts)
							const isExpanded = decision?.isExpanded ?? true
							const collapseDecision = decision?.collapseDecision ?? null
							// The last message in the group is "last" only if this group
							// is also the last Virtuoso item in the list.
							const isLastMessage = isLastInList && msgIdx === messages.length - 1
	
							return (
								<div key={msg.ts} data-message-row={msg.ts} className="py-[4px]">
									<ChatRowContent
										message={msg}
										isExpanded={isExpanded}
										collapseDecision={collapseDecision}
										onToggleExpand={onToggleExpand}
										lastModifiedMessage={lastModifiedMessage}
										isLast={isLastMessage}
										isStreaming={isStreamingForContent}
										onSuggestionClick={onSuggestionClick}
										onBatchFileResponse={onBatchFileResponse}
										onFollowUpUnmount={onFollowUpUnmount}
										isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
										editable={
											msg.type === "ask" &&
											msg.ask === "tool" &&
											(() => {
												let tool: any = {}
												try {
													tool = JSON.parse(msg.text || "{}")
												} catch (_) {
													if (msg.text?.includes("updateTodoList")) {
														tool = { tool: "updateTodoList" }
													}
												}
												return (
													tool.tool === "updateTodoList" &&
													enableButtons &&
													!!primaryButtonText
												)
											})()
										}
										hasCheckpoint={hasCheckpoint}
										completionCheckpoint={
											msg.ts === completionResultTs ? completionCheckpoint : undefined
										}
										onJumpToPreviousCheckpoint={onJumpToPreviousCheckpoint}
									/>
								</div>
							)
						})}
					</div>
				)}
			</div>
		)
	},
)

TaskActivityGroup.displayName = "TaskActivityGroup"

export default TaskActivityGroup
