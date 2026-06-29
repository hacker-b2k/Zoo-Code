import { memo } from "react"
import { ChevronDown, ChevronRight, Activity } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ClineMessage, SuggestionItem, CompletionCheckpoint } from "@roo-code/types"
import type { CollapseDecision } from "@src/utils/messageSize"
import type { TaskActivityViewModel } from "@src/utils/taskActivityViewModel"
import type { ActivitySummary } from "@src/utils/taskActivityStatus"
import { cn } from "@/lib/utils"

import { ChatRowContent } from "./ChatRow"

export interface TaskActivityGroupProps {
	/** The complete view-model derived by ChatView — the only data source for the header */
	viewModel: TaskActivityViewModel
	/** The messages contained in this group (for expanded ChatRowContent rendering) */
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

// ---------------------------------------------------------------------------
// Header sub-components (presentational, no side effects)
// ---------------------------------------------------------------------------

/**
 * Active realtime status badge — shown when the group is collapsed AND active.
 * Renders the current activity label (e.g. "THINKING", "READING", "EDITING")
 * from the i18n status key provided by the view-model.
 */
function ActiveStatusBadge({ statusKey }: { statusKey: string }) {
	const { t } = useTranslation()
	return (
		<span className="ml-auto flex items-center gap-1.5 shrink-0">
			<span className="relative flex h-2 w-2">
				<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-vscode-textLink-foreground opacity-75" />
				<span className="relative inline-flex rounded-full h-2 w-2 bg-vscode-textLink-foreground" />
			</span>
			<span className="text-xs font-medium text-vscode-textLink-foreground uppercase tracking-wider">
				{t(`chat:taskActivity.status.${statusKey}`)}
			</span>
		</span>
	)
}

/**
 * Summary stats line — shown when the group is collapsed AND finished.
 * Renders a compact " · "-separated list of non-zero aggregated stats.
 */
function SummaryStats({ summary }: { summary: ActivitySummary }) {
	const { t } = useTranslation()

	const parts: string[] = []

	if (summary.filesRead > 0) {
		parts.push(t("chat:taskActivity.summary.filesRead", { count: summary.filesRead }))
	}
	if (summary.filesEdited > 0) {
		parts.push(t("chat:taskActivity.summary.filesEdited", { count: summary.filesEdited }))
	}
	if (summary.filesCreated > 0) {
		parts.push(t("chat:taskActivity.summary.filesCreated", { count: summary.filesCreated }))
	}
	if (summary.searches > 0) {
		parts.push(t("chat:taskActivity.summary.searches", { count: summary.searches }))
	}
	if (summary.commands > 0) {
		parts.push(t("chat:taskActivity.summary.commands", { count: summary.commands }))
	}
	if (summary.toolUses > 0) {
		parts.push(t("chat:taskActivity.summary.toolUses", { count: summary.toolUses }))
	}

	if (parts.length === 0) return null

	return (
		<span className="text-xs text-vscode-descriptionForeground ml-auto shrink-0 truncate max-w-[50%]">
			{parts.join(" · ")}
		</span>
	)
}

// ---------------------------------------------------------------------------
// TaskActivityGroup — pure presentational
// ---------------------------------------------------------------------------

/**
 * TaskActivityGroup renders a collapsible summary bar for a group of
 * intermediate agent messages. The component is purely presentational:
 *
 * - **Collapsed + active**: header shows realtime status badge (THINKING, READING, …)
 * - **Collapsed + finished**: header shows aggregated summary stats
 * - **Expanded**: full ChatRowContent message timeline (unchanged behavior)
 *
 * All business logic (activity classification, summary aggregation) lives in
 * `taskActivityStatus.ts` → `taskActivityViewModel.ts`. ChatView computes the
 * view-model and passes it down. This component only renders the supplied data.
 */
const TaskActivityGroup = memo(
	({
		viewModel,
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
					aria-expanded={!isCollapsed}
					aria-label={
						isCollapsed
							? t("chat:taskActivity.expand", { count: viewModel.stepCount })
							: t("chat:taskActivity.collapse", { count: viewModel.stepCount })
					}>
					{isCollapsed ? (
						<ChevronRight className="size-3.5 shrink-0 text-vscode-descriptionForeground" />
					) : (
						<ChevronDown className="size-3.5 shrink-0 text-vscode-descriptionForeground" />
					)}
					<Activity className="size-3.5 shrink-0 text-vscode-textLink-foreground" />
					<span className="text-xs font-medium text-vscode-foreground">{t("chat:taskActivity.label")}</span>
					<span className="text-xs text-vscode-descriptionForeground">
						— {t("chat:taskActivity.stepCount", { count: viewModel.stepCount })}
					</span>
					{isCollapsed && viewModel.headerMode === "active" && (
						<ActiveStatusBadge statusKey={viewModel.currentStatus} />
					)}
					{isCollapsed && viewModel.headerMode === "finished" && <SummaryStats summary={viewModel.summary} />}
				</button>

				{/* Expanded content — each contained message rendered via ChatRowContent */}
				{!isCollapsed && (
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
