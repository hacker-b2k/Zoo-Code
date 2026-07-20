import { memo, useState, useCallback } from "react"
import { ArrowRight, Folder } from "lucide-react"

import { getTaskDisplayTitle, validateTaskCustomTitle, CUSTOM_TITLE_MAX_LENGTH } from "@roo-code/types"

import type { DisplayHistoryItem } from "./types"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { useAppTranslation } from "@/i18n/TranslationContext"

import TaskItemFooter from "./TaskItemFooter"
import { StandardTooltip } from "../ui"

interface TaskItemProps {
	item: DisplayHistoryItem
	variant: "compact" | "full"
	showWorkspace?: boolean
	hasSubtasks?: boolean
	isSelectionMode?: boolean
	isSelected?: boolean
	onToggleSelection?: (taskId: string, isSelected: boolean) => void
	onDelete?: (taskId: string) => void
	className?: string
	/** Currently being renamed task id (only one at a time). */
	renamingTaskId?: string | null
	/** Called when the rename button is clicked. */
	onStartRename?: (taskId: string) => void
	/** Called when inline rename is submitted or cancelled. */
	onFinishRename?: () => void
}

const TaskItem = ({
	item,
	variant,
	showWorkspace = false,
	hasSubtasks = false,
	isSelectionMode = false,
	isSelected = false,
	onToggleSelection,
	onDelete,
	className,
	renamingTaskId,
	onStartRename,
	onFinishRename,
}: TaskItemProps) => {
	const { t } = useAppTranslation()
	const [renameValue, setRenameValue] = useState("")
	const [renameError, setRenameError] = useState<string | null>(null)

	const isRenaming = renamingTaskId === item.id

	const handleStartRename = useCallback(() => {
		setRenameValue(getTaskDisplayTitle(item))
		setRenameError(null)
		onStartRename?.(item.id)
	}, [item, onStartRename])

	const handleSaveRename = useCallback(() => {
		const validation = validateTaskCustomTitle(renameValue, item.task)
		if (!validation.ok) {
			setRenameError(validation.error)
			return
		}

		setRenameError(null)
		vscode.postMessage({ type: "renameTask", taskId: item.id, text: validation.normalized })
		onFinishRename?.()
	}, [item.id, item.task, renameValue, onFinishRename])

	const handleCancelRename = useCallback(() => {
		setRenameValue("")
		setRenameError(null)
		onFinishRename?.()
	}, [onFinishRename])

	const handleClick = () => {
		if (isRenaming) {
			return // Don't navigate while renaming
		}
		if (isSelectionMode && onToggleSelection) {
			onToggleSelection(item.id, !isSelected)
		} else {
			vscode.postMessage({ type: "showTaskWithId", text: item.id })
		}
	}

	const isCompact = variant === "compact"
	const displayTitle = getTaskDisplayTitle(item)
	const hasCustomTitle = !!item.customTitle?.trim()

	return (
		<div
			key={item.id}
			data-testid={`task-item-${item.id}`}
			className={cn(
				"cursor-pointer group relative overflow-hidden",
				"text-vscode-foreground/80 hover:text-vscode-foreground transition-colors",
				hasSubtasks ? "rounded-t-xl" : "rounded-xl",
				className,
			)}
			onClick={handleClick}>
			<div className={(!isCompact && isSelectionMode ? "pl-3 pb-3" : "pl-4") + " flex gap-3 px-3 pt-3 pb-1"}>
				{/* Selection checkbox - only in full variant */}
				{!isCompact && isSelectionMode && (
					<div
						className="task-checkbox mt-1"
						onClick={(e) => {
							e.stopPropagation()
						}}>
						<Checkbox
							checked={isSelected}
							onCheckedChange={(checked: boolean) => onToggleSelection?.(item.id, checked === true)}
							variant="description"
						/>
					</div>
				)}

				<div className="flex-1 min-w-0">
					<div className="flex items-start gap-1">
						{isRenaming ? (
							<div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
								<input
									type="text"
									value={renameValue}
									onChange={(e) => {
										setRenameValue(e.target.value)
										if (renameError) {
											setRenameError(null)
										}
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											handleSaveRename()
										} else if (e.key === "Escape") {
											handleCancelRename()
										}
									}}
									onBlur={handleSaveRename}
									autoFocus
									maxLength={CUSTOM_TITLE_MAX_LENGTH}
									aria-label={t("history:renameTask")}
									placeholder={t("history:renamePlaceholder")}
									className="w-full bg-vscode-input-background text-vscode-foreground border border-vscode-input-border rounded px-1.5 py-0.5 text-sm outline-none"
									data-testid="task-rename-input"
								/>
								{renameError && (
									<div
										className="text-vscode-errorForeground text-xs mt-1"
										role="alert"
										data-testid="task-rename-error">
										{renameError}
									</div>
								)}
							</div>
						) : item.highlight ? (
							<div
								className={cn(
									"flex-1 min-w-0 overflow-hidden whitespace-pre-wrap font-light text-ellipsis line-clamp-3",
									{
										"text-base": !isCompact,
									},
									!isCompact && isSelectionMode ? "mb-1" : "",
								)}
								data-testid="task-content"
								dangerouslySetInnerHTML={{ __html: item.highlight }}
							/>
						) : (
							<div
								className={cn(
									"flex-1 min-w-0 overflow-hidden whitespace-pre-wrap font-light text-ellipsis line-clamp-3",
									{
										"text-base": !isCompact,
									},
									!isCompact && isSelectionMode ? "mb-1" : "",
								)}
								data-testid="task-content">
								<StandardTooltip content={hasCustomTitle ? item.task : displayTitle}>
									<span>{displayTitle}</span>
								</StandardTooltip>
							</div>
						)}
						{/* Arrow icon that appears on hover */}
						<ArrowRight className="size-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
					</div>

					{showWorkspace && item.workspace && (
						<div className="flex items-center font-mono gap-1 text-vscode-descriptionForeground text-xs mt-1">
							<Folder className="size-3" />
							<span>{item.workspace}</span>
						</div>
					)}

					<TaskItemFooter
						item={item}
						variant={variant}
						isSelectionMode={isSelectionMode}
						isSubtask={item.isSubtask}
						onDelete={onDelete}
						onStartRename={handleStartRename}
					/>
				</div>
			</div>
		</div>
	)
}

export default memo(TaskItem)
