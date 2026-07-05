import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { useDeepCompareEffect, useEvent } from "react-use"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import removeMd from "remove-markdown"
import useSound from "use-sound"
import { LRUCache } from "lru-cache"

import { useDebounceEffect } from "@src/utils/useDebounceEffect"
import { appendImages } from "@src/utils/imageUtils"
import { getCostBreakdownIfNeeded } from "@src/utils/costFormatting"
import { batchConsecutive } from "@src/utils/batchConsecutive"
import { buildVirtuosoItems, isTaskActivityGroup } from "@src/utils/taskActivityGrouping"
import type { VirtuosoItem, TaskActivityGroupData } from "@src/utils/taskActivityGrouping"
import { deriveTaskActivityViewModel } from "@src/utils/taskActivityViewModel"

import type { ClineAsk, ClineSayTool, ClineMessage, ExtensionMessage, AudioType, SuggestionItem } from "@roo-code/types"
import type { CollapseDecision } from "@src/utils/messageSize"
import { analyzeMessage, isUserMessage, shouldNeverCollapse } from "@src/utils/messageSize"
import { getCompletionCheckpoint, getSuggestionMode, isRetiredProvider } from "@roo-code/types"

import { findLast } from "@roo/array"
import { combineApiRequests } from "@roo/combineApiRequests"
import { combineCommandSequences } from "@roo/combineCommandSequences"
import { getApiMetrics } from "@roo/getApiMetrics"
import { getAllModes } from "@roo/modes"
import { ProfileValidator } from "@roo/ProfileValidator"
import { getLatestTodo } from "@roo/todo"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"
import RooHero from "@src/components/welcome/RooHero"
import RooTips from "@src/components/welcome/RooTips"
import { StandardTooltip, Button } from "@src/components/ui"

import TelemetryBanner from "../common/TelemetryBanner"
import VersionIndicator from "../common/VersionIndicator"
import HistoryPreview from "../history/HistoryPreview"
import Announcement from "./Announcement"
import ChatRow from "./ChatRow"
import TaskActivityGroup from "./TaskActivityGroup"
import WarningRow from "./WarningRow"
import { ChatTextArea } from "./ChatTextArea"
import TaskHeader from "./TaskHeader"
import ProfileViolationWarning from "./ProfileViolationWarning"
import { CheckpointWarning } from "./CheckpointWarning"
import { QueuedMessages } from "./QueuedMessages"
import { WorktreeSelector } from "./WorktreeSelector"
import FileChangesPanel from "./FileChangesPanel"
import { useScrollLifecycle } from "@src/hooks/useScrollLifecycle"

export interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
}

export interface ChatViewRef {
	acceptInput: () => void
}

export const MAX_IMAGES_PER_MESSAGE = 20 // This is the Anthropic limit.
const CHAT_DEFAULT_ITEM_HEIGHT = 180
const CHAT_VIEWPORT_BUFFER = {
	top: 600,
	bottom: 800,
} as const

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

// Module-level cache for Task Activity group collapse state, keyed by task.ts.
// Persists across chat switches within the same VS Code session.
// Captured when leaving a task, restored when returning.
// Cleared when VS Code restarts (webview recreated).
const taskActivityGroupCache = new Map<
	number,
	{
		groupState: Record<number, { isCollapsed: boolean }>
		manualToggledGroups: Set<number>
	}
>()

const ChatViewComponent: React.ForwardRefRenderFunction<ChatViewRef, ChatViewProps> = (
	{ isHidden, showAnnouncement, hideAnnouncement },
	ref,
) => {
	const [audioBaseUri] = useState(() => {
		return (window as unknown as { AUDIO_BASE_URI?: string }).AUDIO_BASE_URI || ""
	})

	const { t } = useAppTranslation()
	const modeShortcutText = `${isMac ? "⌘" : "Ctrl"} + . ${t("chat:forNextMode")}, ${isMac ? "⌘" : "Ctrl"} + Shift + . ${t("chat:forPreviousMode")}`

	const {
		clineMessages: messages,
		currentTaskItem,
		currentTaskTodos,
		taskHistory,
		apiConfiguration,
		selectedModelCapabilities,
		organizationAllowList,
		mode,
		setMode,
		alwaysAllowModeSwitch,
		customModes,
		soundEnabled,
		soundVolume,
		messageQueue = [],
		showWorktreesInHomeScreen,
		telemetrySetting,
		autoCollapseLongMessages,
		longMessageCollapseThreshold,
		autoCollapseTaskActivity,
	} = useExtensionState()

	// Show a WarningRow when the user sends a message with a retired provider.
	const [showRetiredProviderWarning, setShowRetiredProviderWarning] = useState(false)

	// When the provider changes, clear the retired-provider warning.
	const providerName = apiConfiguration?.apiProvider
	useEffect(() => {
		setShowRetiredProviderWarning(false)
	}, [providerName])

	const messagesRef = useRef(messages)

	useEffect(() => {
		messagesRef.current = messages
	}, [messages])

	// Leaving this less safe version here since if the first message is not a
	// task, then the extension is in a bad state and needs to be debugged (see
	// Cline.abort).
	const task = useMemo(() => messages.at(0), [messages])

	const latestTodos = useMemo(() => {
		// First check if we have initial todos from the state (for new subtasks)
		if (currentTaskTodos && currentTaskTodos.length > 0) {
			// Check if there are any todo updates in messages
			const messageBasedTodos = getLatestTodo(messages)
			// If there are message-based todos, they take precedence (user has updated them)
			if (messageBasedTodos && messageBasedTodos.length > 0) {
				return messageBasedTodos
			}
			// Otherwise use the initial todos from state
			return currentTaskTodos
		}
		// Fall back to extracting from messages
		return getLatestTodo(messages)
	}, [messages, currentTaskTodos])

	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])
	const completionCheckpoint = useMemo(() => getCompletionCheckpoint(messages), [messages])
	const completionResultTs = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i]

			if (message?.type === "say" && message.say === "completion_result") {
				return message.ts
			}

			// Zero-text ask completion rows are hidden by visibleMessages below, so attach
			// actions to the latest renderable completion row while the extension host
			// still derives the checkpoint target from authoritative task state.
			if (message?.type === "ask" && message.ask === "completion_result" && (message.text ?? "") !== "") {
				return message.ts
			}
		}

		return undefined
	}, [messages])

	// Has to be after api_req_finished are all reduced into api_req_started messages.
	// Use cached apiMetrics to avoid recalculating on every render
	const apiMetricsCacheRef = useRef<Map<string, any>>(new Map())
	const apiMetrics = useMemo(() => {
		// Create a simple hash based on messages length and last message timestamp
		const hash = `${modifiedMessages.length}-${modifiedMessages[modifiedMessages.length - 1]?.ts ?? ""}`

		if (apiMetricsCacheRef.current.has(hash)) {
			return apiMetricsCacheRef.current.get(hash)!
		}

		const metrics = getApiMetrics(modifiedMessages)
		apiMetricsCacheRef.current.set(hash, metrics)

		// Limit cache size to prevent memory leaks
		if (apiMetricsCacheRef.current.size > 10) {
			const firstKey = apiMetricsCacheRef.current.keys().next().value
			if (firstKey !== undefined) {
				apiMetricsCacheRef.current.delete(firstKey)
			}
		}

		return metrics
	}, [modifiedMessages])

	const [inputValue, setInputValue] = useState("")
	const inputValueRef = useRef(inputValue)
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [sendingDisabled, setSendingDisabled] = useState(false)
	const [selectedImages, setSelectedImages] = useState<string[]>([])

	// We need to hold on to the ask because useEffect > lastMessage will always
	// let us know when an ask comes in and handle it, but by the time
	// handleMessage is called, the last message might not be the ask anymore
	// (it could be a say that followed).
	const [clineAsk, setClineAsk] = useState<ClineAsk | undefined>(undefined)
	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)
	const [_didClickCancel, setDidClickCancel] = useState(false)
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
	const expandedRowsRef = useRef<Record<number, boolean>>({})
	const prevExpandedRowsRef = useRef<Record<number, boolean>>()
	const [taskActivityGroupState, setTaskActivityGroupState] = useState<Record<number, { isCollapsed: boolean }>>({})
	// Track which groups the user has manually toggled, so auto-collapse
	// does not override an explicit expand/collapse decision.
	const manualToggleRef = useRef<Set<number>>(new Set())
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const lastTtsRef = useRef<string>("")
	const [wasStreaming, setWasStreaming] = useState<boolean>(false)
	const [checkpointWarning, setCheckpointWarning] = useState<
		{ type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"; timeout: number } | undefined
	>(undefined)
	const [isCondensing, setIsCondensing] = useState<boolean>(false)
	const [showAnnouncementModal, setShowAnnouncementModal] = useState(false)
	const everVisibleMessagesTsRef = useRef<LRUCache<number, boolean>>(
		new LRUCache({
			max: 100,
			ttl: 1000 * 60 * 5,
		}),
	)
	const autoApproveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const userRespondedRef = useRef<boolean>(false)
	const [currentFollowUpTs, setCurrentFollowUpTs] = useState<number | null>(null)
	const [aggregatedCostsMap, setAggregatedCostsMap] = useState<
		Map<
			string,
			{
				totalCost: number
				ownCost: number
				childrenCost: number
			}
		>
	>(new Map())

	const clineAskRef = useRef(clineAsk)
	useEffect(() => {
		clineAskRef.current = clineAsk
	}, [clineAsk])

	// Keep inputValueRef in sync with inputValue state
	useEffect(() => {
		inputValueRef.current = inputValue
	}, [inputValue])

	// Compute whether auto-approval is paused (user is typing in a followup)
	const isFollowUpAutoApprovalPaused = useMemo(() => {
		return !!(inputValue && inputValue.trim().length > 0 && clineAsk === "followup")
	}, [inputValue, clineAsk])

	// Cancel auto-approval timeout when user starts typing
	useEffect(() => {
		// Only send cancel if there's actual input (user is typing)
		// and we have a pending follow-up question
		if (isFollowUpAutoApprovalPaused) {
			vscode.postMessage({ type: "cancelAutoApproval" })
		}
	}, [isFollowUpAutoApprovalPaused])

	const isProfileDisabled = useMemo(
		() => !!apiConfiguration && !ProfileValidator.isProfileAllowed(apiConfiguration, organizationAllowList),
		[apiConfiguration, organizationAllowList],
	)

	// UI layout depends on the last 2 messages (since it relies on the content
	// of these messages, we are deep comparing) i.e. the button state after
	// hitting button sets enableButtons to false,  and this effect otherwise
	// would have to true again even if messages didn't change.
	const lastMessage = useMemo(() => messages.at(-1), [messages])
	const secondLastMessage = useMemo(() => messages.at(-2), [messages])

	const volume = typeof soundVolume === "number" ? soundVolume : 0.5
	const [playNotification] = useSound(`${audioBaseUri}/notification.wav`, { volume, soundEnabled, interrupt: true })
	const [playCelebration] = useSound(`${audioBaseUri}/celebration.wav`, { volume, soundEnabled, interrupt: true })
	const [playProgressLoop] = useSound(`${audioBaseUri}/progress_loop.wav`, { volume, soundEnabled, interrupt: true })

	const lastPlayedRef = useRef<Record<string, number>>({})

	const playSound = useCallback(
		(audioType: AudioType) => {
			if (!soundEnabled) {
				return
			}

			const now = Date.now()
			const lastPlayed = lastPlayedRef.current[audioType] ?? 0
			if (now - lastPlayed < 100) {
				return
			} // debounce: skip if played within 100ms
			lastPlayedRef.current[audioType] = now

			switch (audioType) {
				case "notification":
					playNotification()
					break
				case "celebration":
					playCelebration()
					break
				case "progress_loop":
					playProgressLoop()
					break
				default:
					console.warn(`Unknown audio type: ${audioType}`)
			}
		},
		[soundEnabled, playNotification, playCelebration, playProgressLoop],
	)

	function playTts(text: string) {
		vscode.postMessage({ type: "playTts", text })
	}

	useDeepCompareEffect(() => {
		// if last message is an ask, show user ask UI
		// if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
		// basically as long as a task is active, the conversation history will be persisted
		if (lastMessage) {
			switch (lastMessage.type) {
				case "ask":
					// Skip button setup when the ask was already resolved by the backend
					// before the state snapshot reached the webview. isAnswered:true is
					// stamped on the message atomically with addToClineMessages, so the
					// webview never needs to show -- and then clear -- approval buttons.
					if (lastMessage.isAnswered) {
						break
					}
					// Reset user response flag when a new ask arrives to allow auto-approval
					userRespondedRef.current = false
					const isPartial = lastMessage.partial === true
					switch (lastMessage.ask) {
						case "api_req_failed":
							playSound("progress_loop")
							setSendingDisabled(true)
							setClineAsk("api_req_failed")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:retry.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "mistake_limit_reached":
							playSound("progress_loop")
							setSendingDisabled(false)
							setClineAsk("mistake_limit_reached")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedAnyways.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "followup":
							setSendingDisabled(isPartial)
							setClineAsk("followup")
							// setting enable buttons to `false` would trigger a focus grab when
							// the text area is enabled which is undesirable.
							// We have no buttons for this tool, so no problem having them "enabled"
							// to workaround this issue.  See #1358.
							setEnableButtons(true)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "tool":
							setSendingDisabled(isPartial)
							setClineAsk("tool")
							setEnableButtons(!isPartial)
							const tool = JSON.parse(lastMessage.text || "{}") as ClineSayTool
							switch (tool.tool) {
								case "editedExistingFile":
								case "appliedDiff":
								case "newFileCreated":
									if (tool.batchDiffs && Array.isArray(tool.batchDiffs)) {
										setPrimaryButtonText(t("chat:edit-batch.approve.title"))
										setSecondaryButtonText(t("chat:edit-batch.deny.title"))
									} else {
										setPrimaryButtonText(t("chat:save.title"))
										setSecondaryButtonText(t("chat:reject.title"))
									}
									break
								case "generateImage":
									setPrimaryButtonText(t("chat:save.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
								case "finishTask":
									setPrimaryButtonText(t("chat:completeSubtaskAndReturn"))
									setSecondaryButtonText(undefined)
									break
								case "readFile":
									if (tool.batchFiles && Array.isArray(tool.batchFiles)) {
										setPrimaryButtonText(t("chat:read-batch.approve.title"))
										setSecondaryButtonText(t("chat:read-batch.deny.title"))
									} else {
										setPrimaryButtonText(t("chat:approve.title"))
										setSecondaryButtonText(t("chat:reject.title"))
									}
									break
								case "listFilesTopLevel":
								case "listFilesRecursive":
									if (tool.batchDirs && Array.isArray(tool.batchDirs)) {
										setPrimaryButtonText(t("chat:list-batch.approve.title"))
										setSecondaryButtonText(t("chat:list-batch.deny.title"))
									} else {
										setPrimaryButtonText(t("chat:approve.title"))
										setSecondaryButtonText(t("chat:reject.title"))
									}
									break
								default:
									setPrimaryButtonText(t("chat:approve.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
							}
							break
						case "command":
							setSendingDisabled(isPartial)
							setClineAsk("command")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:runCommand.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "command_output":
							setSendingDisabled(false)
							setClineAsk("command_output")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedWhileRunning.title"))
							setSecondaryButtonText(t("chat:killCommand.title"))
							break
						case "use_mcp_server":
							setSendingDisabled(isPartial)
							setClineAsk("use_mcp_server")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:approve.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "completion_result":
							// Extension waiting for feedback, but we can just present a new task button.
							// Kilo-style change inspection/restoration buttons are rendered inline on the completion row.
							// Only play celebration sound if there are no queued messages.
							if (!isPartial && messageQueue.length === 0) {
								playSound("celebration")
							}
							setSendingDisabled(isPartial)
							setClineAsk("completion_result")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							break
						case "resume_task":
							setSendingDisabled(false)
							setClineAsk("resume_task")
							setEnableButtons(true)
							// For completed subtasks, show "Start New Task" instead of "Resume"
							// A subtask is considered completed if:
							// - It has a parentTaskId AND
							// - Its messages contain a completion_result (either ask or say)
							const isCompletedSubtask =
								currentTaskItem?.parentTaskId &&
								messages.some(
									(msg) => msg.ask === "completion_result" || msg.say === "completion_result",
								)
							if (isCompletedSubtask) {
								setPrimaryButtonText(t("chat:startNewTask.title"))
								setSecondaryButtonText(undefined)
							} else {
								setPrimaryButtonText(t("chat:resumeTask.title"))
								setSecondaryButtonText(t("chat:terminate.title"))
							}
							setDidClickCancel(false) // special case where we reset the cancel button state
							break
						case "resume_completed_task":
							setSendingDisabled(false)
							setClineAsk("resume_completed_task")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							setDidClickCancel(false)
							break
					}
					break
				case "say":
					// Don't want to reset since there could be a "say" after
					// an "ask" while ask is waiting for response.
					switch (lastMessage.say) {
						case "api_req_retry_delayed":
						case "api_req_rate_limit_wait":
							setSendingDisabled(true)
							break
						case "api_req_started":
							// Clear button state when a new API request starts
							// This fixes buttons persisting when the task continues
							setSendingDisabled(true)
							// Note: Do NOT clear selectedImages here. This handler fires
							// every time the backend starts an API call, which would wipe
							// images the user has pasted while the chat is in progress.
							// Images are already cleared in the appropriate user-action
							// handlers (handleSendMessage, handlePrimaryButtonClick, etc.).
							setClineAsk(undefined)
							setEnableButtons(false)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "api_req_finished":
						case "error":
						case "text":
						case "command_output":
						case "mcp_server_request_started":
						case "mcp_server_response":
						case "completion_result":
							break
					}
					break
			}
		}
	}, [lastMessage, secondLastMessage])

	// Update button text when messages change (e.g., completion_result is added) for subtasks in resume_task state
	useEffect(() => {
		if (clineAsk === "resume_task" && currentTaskItem?.parentTaskId) {
			const hasCompletionResult = messages.some(
				(msg) => msg.ask === "completion_result" || msg.say === "completion_result",
			)
			if (hasCompletionResult) {
				setPrimaryButtonText(t("chat:startNewTask.title"))
				setSecondaryButtonText(undefined)
			}
		}
	}, [clineAsk, currentTaskItem?.parentTaskId, messages, t])

	useEffect(() => {
		if (messages.length === 0) {
			setSendingDisabled(false)
			setClineAsk(undefined)
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		}
	}, [messages.length])

	// Reset UI states when task changes. Scroll lifecycle is handled by
	// useScrollLifecycle which has its own effect keyed on taskTs.
	useEffect(() => {
		setExpandedRows({})
		everVisibleMessagesTsRef.current.clear()
		setCurrentFollowUpTs(null)
		setIsCondensing(false)

		if (autoApproveTimeoutRef.current) {
			clearTimeout(autoApproveTimeoutRef.current)
			autoApproveTimeoutRef.current = null
		}
		userRespondedRef.current = false
	}, [task?.ts])

	const taskTs = task?.ts

	// Request aggregated costs when task changes and has childIds
	useEffect(() => {
		if (taskTs && currentTaskItem?.childIds && currentTaskItem.childIds.length > 0) {
			vscode.postMessage({
				type: "getTaskWithAggregatedCosts",
				text: currentTaskItem.id,
			})
		}
	}, [taskTs, currentTaskItem?.id, currentTaskItem?.childIds])

	useEffect(() => {
		if (isHidden) {
			everVisibleMessagesTsRef.current.clear()
		}
	}, [isHidden])

	useEffect(() => {
		const cache = everVisibleMessagesTsRef.current
		return () => {
			cache.clear()
		}
	}, [])

	const isStreaming = useMemo(() => {
		// Checking clineAsk isn't enough since messages effect may be called
		// again for a tool for example, set clineAsk to its value, and if the
		// next message is not an ask then it doesn't reset. This is likely due
		// to how much more often we're updating messages as compared to before,
		// and should be resolved with optimizations as it's likely a rendering
		// bug. But as a final guard for now, the cancel button will show if the
		// last message is not an ask.
		const isLastAsk = !!modifiedMessages.at(-1)?.ask

		const isToolCurrentlyAsking =
			isLastAsk && clineAsk !== undefined && enableButtons && primaryButtonText !== undefined

		if (isToolCurrentlyAsking) {
			return false
		}

		const isLastMessagePartial = modifiedMessages.at(-1)?.partial === true

		if (isLastMessagePartial) {
			return true
		} else {
			const lastApiReqStarted = findLast(
				modifiedMessages,
				(message: ClineMessage) => message.say === "api_req_started",
			)

			if (
				lastApiReqStarted &&
				lastApiReqStarted.text !== null &&
				lastApiReqStarted.text !== undefined &&
				lastApiReqStarted.say === "api_req_started"
			) {
				const cost = JSON.parse(lastApiReqStarted.text).cost

				if (cost === undefined) {
					return true // API request has not finished yet.
				}
			}
		}

		return false
	}, [modifiedMessages, clineAsk, enableButtons, primaryButtonText])

	const markFollowUpAsAnswered = useCallback(() => {
		const lastFollowUpMessage = messagesRef.current.findLast((msg: ClineMessage) => msg.ask === "followup")
		if (lastFollowUpMessage) {
			setCurrentFollowUpTs(lastFollowUpMessage.ts)
		}
	}, [])

	const handleChatReset = useCallback(() => {
		// Clear any pending auto-approval timeout
		if (autoApproveTimeoutRef.current) {
			clearTimeout(autoApproveTimeoutRef.current)
			autoApproveTimeoutRef.current = null
		}
		// Reset user response flag for new message
		userRespondedRef.current = false

		// Only reset message-specific state, preserving mode.
		setInputValue("")
		setSendingDisabled(true)
		setSelectedImages([])
		setClineAsk(undefined)
		setEnableButtons(false)
		// Do not reset mode here as it should persist.
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
	}, [])

	/**
	 * Handles sending messages to the extension
	 * @param text - The message text to send
	 * @param images - Array of image data URLs to send with the message
	 */
	const handleSendMessage = useCallback(
		(text: string, images: string[]) => {
			text = text.trim()

			if (text || images.length > 0) {
				// Intercept when the active provider is retired — show a
				// WarningRow instead of sending anything to the backend.
				if (apiConfiguration?.apiProvider && isRetiredProvider(apiConfiguration.apiProvider)) {
					setShowRetiredProviderWarning(true)
					return
				}

				// Queue message if:
				// - Task is busy (sendingDisabled)
				// - API request in progress (isStreaming)
				// - Queue has items (preserve message order during drain)
				// - Command is running (command_output) - user's message should be queued for AI, not sent to terminal
				if (
					sendingDisabled ||
					isStreaming ||
					messageQueue.length > 0 ||
					clineAskRef.current === "command_output"
				) {
					try {
						console.log("queueMessage", text, images)
						vscode.postMessage({ type: "queueMessage", text, images })
						setInputValue("")
						setSelectedImages([])
					} catch (error) {
						console.error(
							`Failed to queue message: ${error instanceof Error ? error.message : String(error)}`,
						)
					}

					return
				}

				// Mark that user has responded - this prevents any pending auto-approvals.
				userRespondedRef.current = true

				if (messagesRef.current.length === 0) {
					vscode.postMessage({ type: "newTask", text, images })
				} else if (clineAskRef.current) {
					if (clineAskRef.current === "followup") {
						markFollowUpAsAnswered()
					}

					// Use clineAskRef.current
					switch (
						clineAskRef.current // Use clineAskRef.current
					) {
						case "followup":
						case "tool":
						case "command": // User can provide feedback to a tool or command use.
						case "use_mcp_server":
						case "completion_result": // If this happens then the user has feedback for the completion result.
						case "resume_task":
						case "resume_completed_task":
						case "mistake_limit_reached":
							vscode.postMessage({
								type: "askResponse",
								askResponse: "messageResponse",
								text,
								images,
							})
							break
						// There is no other case that a textfield should be enabled.
					}
				} else {
					// This is a new message in an ongoing task.
					vscode.postMessage({ type: "askResponse", askResponse: "messageResponse", text, images })
				}

				handleChatReset()
			}
		},
		[
			handleChatReset,
			markFollowUpAsAnswered,
			sendingDisabled,
			isStreaming,
			messageQueue.length,
			apiConfiguration?.apiProvider,
		], // messagesRef and clineAskRef are stable
	)

	const handleSetChatBoxMessage = useCallback(
		(text: string, images: string[]) => {
			// Avoid nested template literals by breaking down the logic
			let newValue = text

			if (inputValue !== "") {
				newValue = inputValue + " " + text
			}

			setInputValue(newValue)
			setSelectedImages([...selectedImages, ...images])
		},
		[inputValue, selectedImages],
	)

	const startNewTask = useCallback(() => {
		setShowRetiredProviderWarning(false)
		vscode.postMessage({ type: "clearTask" })
	}, [])

	// Handle stop button click from textarea
	const handleStopTask = useCallback(() => {
		vscode.postMessage({ type: "cancelTask" })
		setDidClickCancel(true)
	}, [setDidClickCancel])

	// Handle enqueue button click from textarea
	const handleEnqueueCurrentMessage = useCallback(() => {
		const text = inputValue.trim()
		if (text || selectedImages.length > 0) {
			vscode.postMessage({
				type: "queueMessage",
				text,
				images: selectedImages,
			})
			setInputValue("")
			setSelectedImages([])
		}
	}, [inputValue, selectedImages])

	// Resets the approval button UI to its hidden/disabled state. Shared by the
	// manual click handlers and by the backend-driven clearApprovalButtons
	// message so auto-approved/denied asks hide the buttons through the same
	// pathway a manual click uses.
	const clearApprovalButtons = useCallback(() => {
		setSendingDisabled(true)
		setClineAsk(undefined)
		setEnableButtons(false)
		setPrimaryButtonText(undefined)
		setSecondaryButtonText(undefined)
	}, [])

	// This logic depends on the useEffect[messages] above to set clineAsk,
	// after which buttons are shown and we then send an askResponse to the
	// extension.
	const handlePrimaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			// Mark that user has responded
			userRespondedRef.current = true

			const trimmedInput = text?.trim()

			switch (clineAsk) {
				case "api_req_failed":
				case "command":
				case "tool":
				case "use_mcp_server":
				case "mistake_limit_reached":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
							text: trimmedInput,
							images: images,
						})
						// Clear input state after sending
						setInputValue("")
						setSelectedImages([])
					} else {
						vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
					}
					break
				case "resume_task":
					// For completed subtasks (tasks with a parentTaskId and a completion_result),
					// start a new task instead of resuming since the subtask is done
					const isCompletedSubtaskForClick =
						currentTaskItem?.parentTaskId &&
						messagesRef.current.some(
							(msg) => msg.ask === "completion_result" || msg.say === "completion_result",
						)
					if (isCompletedSubtaskForClick) {
						startNewTask()
					} else {
						// Only send text/images if they exist
						if (trimmedInput || (images && images.length > 0)) {
							vscode.postMessage({
								type: "askResponse",
								askResponse: "yesButtonClicked",
								text: trimmedInput,
								images: images,
							})
							// Clear input state after sending
							setInputValue("")
							setSelectedImages([])
						} else {
							vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
						}
					}
					break
				case "completion_result":
					startNewTask()
					break
				case "resume_completed_task":
					// Waiting for feedback, but we can just present a new task button
					startNewTask()
					break
				case "command_output":
					vscode.postMessage({ type: "terminalOperation", terminalOperation: "continue" })
					break
			}

			clearApprovalButtons()
		},
		[clineAsk, startNewTask, currentTaskItem?.parentTaskId, clearApprovalButtons],
	)

	const handleSecondaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			// Mark that user has responded
			userRespondedRef.current = true

			const trimmedInput = text?.trim()

			if (isStreaming) {
				vscode.postMessage({ type: "cancelTask" })
				setDidClickCancel(true)
				return
			}

			switch (clineAsk) {
				case "api_req_failed":
				case "mistake_limit_reached":
				case "resume_task":
					startNewTask()
					break
				case "command":
				case "tool":
				case "use_mcp_server":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "noButtonClicked",
							text: trimmedInput,
							images: images,
						})
						// Clear input state after sending
						setInputValue("")
						setSelectedImages([])
					} else {
						// Responds to the API with a "This operation failed" and lets it try again
						vscode.postMessage({ type: "askResponse", askResponse: "noButtonClicked" })
					}
					break
				case "command_output":
					vscode.postMessage({ type: "terminalOperation", terminalOperation: "abort" })
					break
			}
			clearApprovalButtons()
		},
		[clineAsk, startNewTask, isStreaming, setDidClickCancel, clearApprovalButtons],
	)

	const { info: model } = useSelectedModel(apiConfiguration, selectedModelCapabilities)

	const selectImages = useCallback(() => vscode.postMessage({ type: "selectImages" }), [])

	const shouldDisableImages = !model?.supportsImages || selectedImages.length >= MAX_IMAGES_PER_MESSAGE

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data

			switch (message.type) {
				case "action":
					switch (message.action!) {
						case "didBecomeVisible":
							if (!isHidden && !sendingDisabled && !enableButtons) {
								textAreaRef.current?.focus()
							}
							break
						case "focusInput":
							textAreaRef.current?.focus()
							break
					}
					break
				case "selectedImages":
					// Only handle selectedImages if it's not for editing context
					// When context is "edit", ChatRow will handle the images
					if (message.context !== "edit") {
						setSelectedImages((prevImages: string[]) =>
							appendImages(prevImages, message.images, MAX_IMAGES_PER_MESSAGE),
						)
					}
					break
				case "invoke":
					switch (message.invoke!) {
						case "newChat":
							handleChatReset()
							break
						case "sendMessage":
							handleSendMessage(message.text ?? "", message.images ?? [])
							break
						case "setChatBoxMessage":
							handleSetChatBoxMessage(message.text ?? "", message.images ?? [])
							break
						case "primaryButtonClick":
							handlePrimaryButtonClick(message.text ?? "", message.images ?? [])
							break
						case "secondaryButtonClick":
							handleSecondaryButtonClick(message.text ?? "", message.images ?? [])
							break
					}
					break
				case "condenseTaskContextStarted":
					// Handle both manual and automatic condensation start
					// We don't check the task ID because:
					// 1. There can only be one active task at a time
					// 2. Task switching resets isCondensing to false (see useEffect with task?.ts dependency)
					// 3. For new tasks, currentTaskItem may not be populated yet due to async state updates
					if (message.text) {
						setIsCondensing(true)
						// Note: sendingDisabled is only set for manual condensation via handleCondenseContext
						// Automatic condensation doesn't disable sending since the task is already running
					}
					break
				case "condenseTaskContextResponse":
					// Same reasoning as above - we trust this is for the current task
					if (message.text) {
						if (isCondensing && sendingDisabled) {
							setSendingDisabled(false)
						}
						setIsCondensing(false)
					}
					break
				case "checkpointInitWarning":
					setCheckpointWarning(message.checkpointWarning)
					break
				case "interactionRequired":
					playSound("notification")
					break
				case "taskWithAggregatedCosts":
					if (message.text && message.aggregatedCosts) {
						setAggregatedCostsMap((prev) => {
							const newMap = new Map(prev)
							newMap.set(message.text!, message.aggregatedCosts!)
							return newMap
						})
					}
					break
			}
			// textAreaRef.current is not explicitly required here since React
			// guarantees that ref will be stable across re-renders, and we're
			// not using its value but its reference.
		},
		[
			isCondensing,
			isHidden,
			sendingDisabled,
			enableButtons,
			handleChatReset,
			handleSendMessage,
			handleSetChatBoxMessage,
			handlePrimaryButtonClick,
			handleSecondaryButtonClick,
			setCheckpointWarning,
			playSound,
		],
	)

	useEvent("message", handleMessage)

	const visibleMessages = useMemo(() => {
		// Pre-compute checkpoint hashes that have associated user messages for O(1) lookup
		const userMessageCheckpointHashes = new Set<string>()
		modifiedMessages.forEach((msg) => {
			if (
				msg.say === "user_feedback" &&
				msg.checkpoint &&
				msg.checkpoint["type"] === "user_message" &&
				msg.checkpoint["hash"]
			) {
				userMessageCheckpointHashes.add(msg.checkpoint["hash"] as string)
			}
		})

		// Remove the 500-message limit to prevent array index shifting
		// Virtuoso is designed to efficiently handle large lists through virtualization
		const newVisibleMessages = modifiedMessages.filter((message) => {
			// Filter out checkpoint_saved messages that should be suppressed
			if (message.say === "checkpoint_saved") {
				// Check if this checkpoint has the suppressMessage flag set
				if (
					message.checkpoint &&
					typeof message.checkpoint === "object" &&
					"suppressMessage" in message.checkpoint &&
					message.checkpoint.suppressMessage
				) {
					return false
				}
				// Also filter out checkpoint messages associated with user messages (legacy behavior)
				if (message.text && userMessageCheckpointHashes.has(message.text)) {
					return false
				}
			}

			if (everVisibleMessagesTsRef.current.has(message.ts)) {
				const alwaysHiddenOnceProcessedAsk: ClineAsk[] = [
					"api_req_failed",
					"resume_task",
					"resume_completed_task",
				]
				const alwaysHiddenOnceProcessedSay = [
					"api_req_finished",
					"api_req_retried",
					"api_req_deleted",
					"mcp_server_request_started",
				]
				if (message.ask && alwaysHiddenOnceProcessedAsk.includes(message.ask)) return false
				if (message.say && alwaysHiddenOnceProcessedSay.includes(message.say)) return false
				if (message.say === "text" && (message.text ?? "") === "" && (message.images?.length ?? 0) === 0) {
					return false
				}
				return true
			}

			switch (message.ask) {
				case "completion_result":
					if (message.text === "") return false
					break
				case "api_req_failed":
				case "resume_task":
				case "resume_completed_task":
					return false
			}
			switch (message.say) {
				case "api_req_finished":
				case "api_req_retried":
				case "api_req_deleted":
					return false
				case "api_req_retry_delayed":
				case "api_req_rate_limit_wait":
					const last1 = modifiedMessages.at(-1)
					const last2 = modifiedMessages.at(-2)
					if (last1?.ask === "resume_task" && last2 === message) {
						return true
					} else if (message !== last1) {
						return false
					}
					break
				case "text":
					if ((message.text ?? "") === "" && (message.images?.length ?? 0) === 0) return false
					break
				case "mcp_server_request_started":
					return false
			}
			return true
		})

		const viewportStart = Math.max(0, newVisibleMessages.length - 100)
		newVisibleMessages
			.slice(viewportStart)
			.forEach((msg: ClineMessage) => everVisibleMessagesTsRef.current.set(msg.ts, true))

		return newVisibleMessages
	}, [modifiedMessages])

	useEffect(() => {
		const cleanupInterval = setInterval(() => {
			const cache = everVisibleMessagesTsRef.current
			const currentMessageIds = new Set(modifiedMessages.map((m: ClineMessage) => m.ts))
			const viewportMessages = visibleMessages.slice(Math.max(0, visibleMessages.length - 100))
			const viewportMessageIds = new Set(viewportMessages.map((m: ClineMessage) => m.ts))

			cache.forEach((_value: boolean, key: number) => {
				if (!currentMessageIds.has(key) && !viewportMessageIds.has(key)) {
					cache.delete(key)
				}
			})
		}, 60000)

		return () => clearInterval(cleanupInterval)
	}, [modifiedMessages, visibleMessages])

	useDebounceEffect(
		() => {
			if (!isHidden && !sendingDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		},
		50,
		[isHidden, sendingDisabled, enableButtons],
	)

	useEffect(() => {
		// This ensures the first message is not read, future user messages are
		// labeled as `user_feedback`.
		if (lastMessage && messages.length > 1) {
			if (
				typeof lastMessage.text === "string" && // has text (must be string for startsWith)
				(lastMessage.say === "text" || lastMessage.say === "completion_result") && // is a text message
				!lastMessage.partial && // not a partial message
				!lastMessage.text.startsWith("{") // not a json object
			) {
				let text = lastMessage?.text || ""
				const mermaidRegex = /```mermaid[\s\S]*?```/g
				// remove mermaid diagrams from text
				text = text.replace(mermaidRegex, "")
				// remove markdown from text
				text = removeMd(text)

				// ensure message is not a duplicate of last read message
				if (text !== lastTtsRef.current) {
					try {
						playTts(text)
						lastTtsRef.current = text
					} catch (error) {
						console.error("Failed to execute text-to-speech:", error)
					}
				}
			}
		}

		// Update previous value.
		setWasStreaming(isStreaming)
	}, [isStreaming, lastMessage, wasStreaming, messages.length])

	const groupedMessages = useMemo(() => {
		const filtered: ClineMessage[] = visibleMessages

		// Helper to check if a message is a read_file ask that should be batched
		const isReadFileAsk = (msg: ClineMessage): boolean => {
			if (msg.type !== "ask" || msg.ask !== "tool") return false
			try {
				const tool = JSON.parse(msg.text || "{}")
				return tool.tool === "readFile" && !tool.batchFiles // Don't re-batch already batched
			} catch {
				return false
			}
		}

		// Helper to check if a message is a list_files ask that should be batched
		const isListFilesAsk = (msg: ClineMessage): boolean => {
			if (msg.type !== "ask" || msg.ask !== "tool") return false
			try {
				const tool = JSON.parse(msg.text || "{}")
				return (
					(tool.tool === "listFilesTopLevel" || tool.tool === "listFilesRecursive") && !tool.batchDirs // Don't re-batch already batched
				)
			} catch {
				return false
			}
		}

		// Set of tool names that represent file-editing operations
		const editFileTools = new Set([
			"editedExistingFile",
			"appliedDiff",
			"newFileCreated",
			"insertContent",
			"searchAndReplace",
		])

		// Helper to check if a message is a file-edit ask that should be batched
		const isEditFileAsk = (msg: ClineMessage): boolean => {
			if (msg.type !== "ask" || msg.ask !== "tool") return false
			try {
				const tool = JSON.parse(msg.text || "{}")
				return editFileTools.has(tool.tool) && !tool.batchDiffs // Don't re-batch already batched
			} catch {
				return false
			}
		}

		// Synthesize a batch of consecutive read_file asks into a single message
		const synthesizeReadFileBatch = (batch: ClineMessage[]): ClineMessage => {
			const batchFiles = batch.map((batchMsg) => {
				try {
					const tool = JSON.parse(batchMsg.text || "{}")
					return {
						path: tool.path || "",
						lineSnippet: tool.reason || "",
						isOutsideWorkspace: tool.isOutsideWorkspace || false,
						key: `${tool.path}${tool.reason ? ` (${tool.reason})` : ""}`,
						content: tool.content || "",
					}
				} catch {
					return { path: "", lineSnippet: "", key: "", content: "" }
				}
			})

			let firstTool
			try {
				firstTool = JSON.parse(batch[0].text || "{}")
			} catch {
				return batch[0]
			}
			return {
				...batch[0],
				text: JSON.stringify({ ...firstTool, batchFiles }),
			}
		}

		// Synthesize a batch of consecutive list_files asks into a single message
		const synthesizeListFilesBatch = (batch: ClineMessage[]): ClineMessage => {
			const batchDirs = batch.map((batchMsg) => {
				try {
					const tool = JSON.parse(batchMsg.text || "{}")
					return {
						path: tool.path || "",
						recursive: tool.tool === "listFilesRecursive",
						isOutsideWorkspace: tool.isOutsideWorkspace || false,
						key: tool.path || "",
					}
				} catch {
					return { path: "", recursive: false, key: "" }
				}
			})

			let firstTool
			try {
				firstTool = JSON.parse(batch[0].text || "{}")
			} catch {
				return batch[0]
			}
			return {
				...batch[0],
				text: JSON.stringify({ ...firstTool, batchDirs }),
			}
		}

		// Synthesize a batch of consecutive file-edit asks into a single message
		const synthesizeEditFileBatch = (batch: ClineMessage[]): ClineMessage => {
			const batchDiffs = batch.map((batchMsg) => {
				try {
					const tool = JSON.parse(batchMsg.text || "{}")
					return {
						path: tool.path || "",
						changeCount: 1,
						key: tool.path || "",
						content: tool.content || tool.diff || "",
						diffStats: tool.diffStats,
					}
				} catch {
					return { path: "", changeCount: 0, key: "", content: "" }
				}
			})

			let firstTool
			try {
				firstTool = JSON.parse(batch[0].text || "{}")
			} catch {
				return batch[0]
			}
			return {
				...batch[0],
				text: JSON.stringify({ ...firstTool, batchDiffs }),
			}
		}

		// Consolidate consecutive ask messages into batches
		const readFileBatched = batchConsecutive(filtered, isReadFileAsk, synthesizeReadFileBatch)
		const listFilesBatched = batchConsecutive(readFileBatched, isListFilesAsk, synthesizeListFilesBatch)
		const result = batchConsecutive(listFilesBatched, isEditFileAsk, synthesizeEditFileBatch)

		if (isCondensing) {
			result.push({
				type: "say",
				say: "condense_context",
				ts: Date.now(),
				partial: true,
			} as ClineMessage)
		}
		return result
	}, [isCondensing, visibleMessages])

	// Build the Virtuoso item list by grouping consecutive intermediate
	// (groupable) messages into TaskActivityGroupData wrappers.
	// This sits between groupedMessages and Virtuoso's data prop.
	// Command boundary uses the same assistant threshold as collapseDecisions
	// so small completed commands are absorbed into the Task Activity.
	const commandCollapseThreshold = (longMessageCollapseThreshold ?? 10) * 2
	const virtuosoItems = useMemo(
		() =>
			buildVirtuosoItems(groupedMessages, {
				commandCollapseThreshold: autoCollapseLongMessages ? commandCollapseThreshold : undefined,
			}),
		[groupedMessages, commandCollapseThreshold, autoCollapseLongMessages],
	)

	const checkpointIndices = useMemo(() => {
		const indices: number[] = []
		for (let i = 0; i < virtuosoItems.length; i++) {
			const item = virtuosoItems[i]
			if (!isTaskActivityGroup(item) && item.say === "checkpoint_saved") {
				indices.push(i)
			}
		}
		return indices
	}, [virtuosoItems])

	const hasLatestCheckpoint = checkpointIndices.length > 0
	const checkpointJumpCursorRef = useRef<number | null>(null)

	useEffect(() => {
		checkpointJumpCursorRef.current = null
	}, [task?.ts, checkpointIndices.length])

	// Scroll lifecycle is managed by a dedicated hook to keep ChatView focused
	// on message handling and UI orchestration.
	const {
		showScrollToBottom,
		handleRowHeightChange,
		handleScrollToBottomClick,
		enterUserBrowsingHistory,
		followOutputCallback,
		atBottomStateChangeCallback,
		scrollToBottomAuto,
		isAtBottomRef,
		scrollPhaseRef,
	} = useScrollLifecycle({
		virtuosoRef,
		scrollContainerRef,
		taskTs: task?.ts,
		isStreaming,
		isHidden,
		hasTask: !!task,
	})

	// Expanding a row indicates the user is browsing; disable sticky follow.
	// Placed after the hook call so enterUserBrowsingHistory is defined.
	useEffect(() => {
		const prev = prevExpandedRowsRef.current
		let wasAnyRowExpandedByUser = false
		if (prev) {
			for (const [tsKey, isExpanded] of Object.entries(expandedRows)) {
				const ts = Number(tsKey)
				if (isExpanded && !(prev[ts] ?? false)) {
					wasAnyRowExpandedByUser = true
					break
				}
			}
		}

		if (wasAnyRowExpandedByUser) {
			enterUserBrowsingHistory("row-expansion")
		}

		prevExpandedRowsRef.current = expandedRows
	}, [enterUserBrowsingHistory, expandedRows])

	// Clear ephemeral manual overrides when collapse-relevant inputs change.
	// This ensures that expanding/collapsing a message is a temporary action:
	// - When a new message arrives (groupedMessages.length changes), overrides reset
	// - When the user changes auto-collapse settings, overrides reset
	// - During streaming (same message count), overrides persist for good UX
	const prevVirtuosoItemsLengthRef = useRef(virtuosoItems.length)
	if (prevVirtuosoItemsLengthRef.current !== virtuosoItems.length) {
		prevVirtuosoItemsLengthRef.current = virtuosoItems.length
		// Schedule state reset using the "state adjustment during render" pattern.
		// React 18 batches this with the current render for efficiency.
		setExpandedRows({})
	}

	useEffect(() => {
		setExpandedRows({})
	}, [autoCollapseLongMessages, longMessageCollapseThreshold])

	// Persist task activity group state and manual-toggle tracking across chat switches.
	// When the task changes, save current state to the module-level cache before switching.
	// When returning to a previously-visited task, restore from cache to preserve manual
	// expand/collapse choices. Only start fresh for a task with no cache entry (truly new task).
	const prevTaskTsRef = useRef<number | undefined>(task?.ts)
	if (task?.ts !== prevTaskTsRef.current) {
		// Save the outgoing task's state before switching.
		if (prevTaskTsRef.current !== undefined) {
			taskActivityGroupCache.set(prevTaskTsRef.current, {
				groupState: taskActivityGroupState,
				manualToggledGroups: new Set(manualToggleRef.current),
			})
		}
		prevTaskTsRef.current = task?.ts
		// Restore state for the incoming task, or start fresh.
		const cached = task?.ts !== undefined ? taskActivityGroupCache.get(task.ts) : undefined
		if (cached) {
			setTaskActivityGroupState(cached.groupState)
			manualToggleRef.current = new Set(cached.manualToggledGroups)
		} else {
			setTaskActivityGroupState({})
			manualToggleRef.current = new Set()
		}
	}

	// Unified lifecycle auto-collapse effect.
	//
	// Each Task Activity group has a lifecycle:
	//   - Active: the agent is currently working on this group.
	//     A group is active iff it is the latest (newest) group AND isStreaming is true.
	//     Active groups are expanded by default.
	//   - Finished: the agent has moved past this group.
	//     A group is finished if it is NOT the latest group (a newer group exists),
	//     OR if it IS the latest group but isStreaming is false (agent stopped).
	//     Finished groups are auto-collapsed.
	//
	// This single effect replaces both the previous "new group creation" effect
	// (which collapsed older groups when a newer one appeared) and the
	// "isStreaming transition" effect (which tried to collapse the last group
	// when streaming stopped). Both were patches on a flat state model; this
	// effect derives collapse state from each group's lifecycle directly.
	//
	// Manual user interaction always wins — groups recorded in manualToggleRef
	// are never overridden by this effect.
	// Extract latestGroupTs so it can be shared between the lifecycle effect
	// and the itemContent callback (where viewModel is derived per group).
	const latestGroupTs = useMemo(() => {
		let latest: number | undefined
		for (const item of virtuosoItems) {
			if (isTaskActivityGroup(item)) {
				const ts = (item as TaskActivityGroupData).ts
				if (latest === undefined || ts > latest) {
					latest = ts
				}
			}
		}
		return latest
	}, [virtuosoItems])

	useEffect(() => {
		if (!autoCollapseTaskActivity) return

		setTaskActivityGroupState((prev) => {
			const next: Record<number, { isCollapsed: boolean }> = {}
			let changed = false

			for (const item of virtuosoItems) {
				if (!isTaskActivityGroup(item)) continue
				const ts = (item as TaskActivityGroupData).ts

				// A group is "active" if it is the latest AND the agent is streaming.
				const isActive = ts === latestGroupTs && isStreaming

				if (manualToggleRef.current.has(ts)) {
					// User manually changed this group — preserve their choice.
					next[ts] = prev[ts] ?? { isCollapsed: false }
				} else if (isActive) {
					// Active group: expanded by default.
					next[ts] = { isCollapsed: false }
				} else {
					// Finished group: auto-collapse.
					next[ts] = { isCollapsed: true }
				}

				if (prev[ts]?.isCollapsed !== next[ts].isCollapsed) {
					changed = true
				}
			}

			// Detect if groups were removed (e.g. message list changed).
			const prevKeyCount = Object.keys(prev).length
			const nextKeyCount = Object.keys(next).length
			if (prevKeyCount !== nextKeyCount) {
				changed = true
			}

			return changed ? next : prev
		})
	}, [virtuosoItems, isStreaming, autoCollapseTaskActivity, latestGroupTs])

	// Toggle collapse state for a task activity group.
	const handleToggleTaskActivity = useCallback((groupTs: number) => {
		// Record the manual interaction so completion auto-collapse
		// does not override the user's explicit choice.
		manualToggleRef.current.add(groupTs)
		setTaskActivityGroupState((prev) => ({
			...prev,
			[groupTs]: { isCollapsed: !(prev[groupTs]?.isCollapsed ?? false) },
		}))
	}, [])

	// One-expanded-at-a-time: expanding a message replaces all overrides with just that entry.
	// Collapsing clears everything (reverts to auto-collapse rules).
	const handleSetExpandedRow = useCallback(
		(ts: number, expand?: boolean) => {
			setExpandedRows((prev: Record<number, boolean>) => {
				const isCurrentlyExpanded = prev[ts] === true
				const shouldBeExpanded = expand === undefined ? !isCurrentlyExpanded : expand
				return shouldBeExpanded ? { [ts]: true } : {}
			})
		},
		[setExpandedRows], // setExpandedRows is stable
	)

	// Scroll when user toggles certain rows.
	const toggleRowExpansion = useCallback(
		(ts: number) => {
			handleSetExpandedRow(ts)
			// The logic to set disableAutoScrollRef.current = true on expansion
			// is now handled by the useEffect hook that observes expandedRows.
		},
		[handleSetExpandedRow],
	)

	// Keep the ref in sync so the click-outside handler can read current state without re-subscribing.
	useEffect(() => {
		expandedRowsRef.current = expandedRows
	}, [expandedRows])

	// Click-outside detection: clicking outside any message row collapses all expanded messages.
	// Uses mousedown (not click) so it fires before focus changes and other interactions.
	// Listens on document (not scrollContainerRef) because the scroll container is conditionally
	// rendered under {task && ...} and its ref is null when this effect first runs.
	useEffect(() => {
		const handleMouseDownOutside = (e: MouseEvent) => {
			// Only act when there is at least one expanded message
			if (Object.keys(expandedRowsRef.current).length === 0) return

			const target = e.target as HTMLElement
			// If the click is NOT inside a message row, collapse everything
			if (!target.closest("[data-message-row]")) {
				setExpandedRows({})
			}
		}

		document.addEventListener("mousedown", handleMouseDownOutside)
		return () => document.removeEventListener("mousedown", handleMouseDownOutside)
	}, []) // empty deps — reads from ref, stable setExpandedRows

	// Effect to clear checkpoint warning when messages appear or task changes
	useEffect(() => {
		if (isHidden || !task) {
			setCheckpointWarning(undefined)
		}
	}, [modifiedMessages.length, isStreaming, isHidden, task])

	const placeholderText = task ? t("chat:typeMessage") : t("chat:typeTask")

	const switchToMode = useCallback(
		(modeSlug: string): void => {
			if (!getAllModes(customModes).some((modeConfig) => modeConfig.slug === modeSlug)) {
				return
			}

			// Update local state and notify extension to sync mode change.
			setMode(modeSlug)

			// Send the mode switch message.
			vscode.postMessage({ type: "mode", text: modeSlug })
		},
		[customModes, setMode],
	)

	const handleSuggestionClickInRow = useCallback(
		(suggestion: SuggestionItem, event?: React.MouseEvent) => {
			// Mark that user has responded if this is a manual click (not auto-approval)
			if (event) {
				userRespondedRef.current = true
			}

			// Mark the current follow-up question as answered when a suggestion is clicked
			if (clineAsk === "followup" && !event?.shiftKey) {
				markFollowUpAsAnswered()
			}

			// Check if we need to switch modes
			const suggestionMode = getSuggestionMode(suggestion.mode)
			if (suggestionMode) {
				// Only switch modes if it's a manual click (event exists) or auto-approval is allowed
				const isManualClick = !!event
				if (isManualClick || alwaysAllowModeSwitch) {
					// Switch mode without waiting
					switchToMode(suggestionMode)
				}
			}

			if (event?.shiftKey) {
				// Always append to existing text, don't overwrite
				setInputValue((currentValue: string) => {
					return currentValue !== "" ? `${currentValue} \n${suggestion.answer}` : suggestion.answer
				})
			} else {
				// Don't clear the input value when sending a follow-up choice
				// The message should be sent but the text area should preserve what the user typed
				const preservedInput = inputValueRef.current
				handleSendMessage(suggestion.answer, [])
				// Restore the input value after sending
				setInputValue(preservedInput)
			}
		},
		[handleSendMessage, setInputValue, switchToMode, alwaysAllowModeSwitch, clineAsk, markFollowUpAsAnswered],
	)

	const handleBatchFileResponse = useCallback((response: { [key: string]: boolean }) => {
		// Handle batch file response, e.g., for file uploads
		vscode.postMessage({ type: "askResponse", askResponse: "objectResponse", text: JSON.stringify(response) })
	}, [])

	// Cancel backend auto-approval timeout when FollowUpSuggest's countdown effect cleans up.
	// This is called when auto-approve is toggled off, a suggestion is clicked, or the component unmounts.
	const handleFollowUpUnmount = useCallback(() => {
		vscode.postMessage({ type: "cancelAutoApproval" })
	}, [])

	const handleScrollToBottomAndResetCheckpointCursor = useCallback(() => {
		checkpointJumpCursorRef.current = null
		handleScrollToBottomClick()
	}, [handleScrollToBottomClick])

	const handleScrollToLatestCheckpoint = useCallback(() => {
		if (checkpointIndices.length === 0) {
			return
		}

		const previousCursor = checkpointJumpCursorRef.current
		const nextCursor = previousCursor === null ? checkpointIndices.length - 1 : Math.max(0, previousCursor - 1)
		const nextCheckpointIndex = checkpointIndices[nextCursor]
		checkpointJumpCursorRef.current = nextCursor

		enterUserBrowsingHistory("keyboard-nav-up")
		virtuosoRef.current?.scrollToIndex({
			index: nextCheckpointIndex,
			align: "center",
			behavior: "smooth",
		})
	}, [checkpointIndices, enterUserBrowsingHistory])

	// Pre-compute collapse decisions for all messages at the ChatView level.
	// This avoids Rules-of-Hooks violations (itemContent is not a React component)
	// and ensures O(1) lookup per Virtuoso item.
	const collapseDecisions = useMemo(() => {
		const decisions = new Map<number, { isExpanded: boolean; collapseDecision: CollapseDecision | null }>()
		const totalMessages = groupedMessages.length
		// Per-type thresholds: user messages collapse sooner than assistant messages.
		// The slider value is the user threshold; assistant uses 2x.
		// Default 10 → user at 10, assistant at 20.
		const userThreshold = longMessageCollapseThreshold ?? 10
		const assistantThreshold = userThreshold * 2
		groupedMessages.forEach((msg, index) => {
			const isLast = index === totalMessages - 1
			if (shouldNeverCollapse(msg, isLast)) {
				decisions.set(msg.ts, { isExpanded: true, collapseDecision: null })
			} else if (!autoCollapseLongMessages) {
				decisions.set(msg.ts, { isExpanded: true, collapseDecision: null })
			} else if (expandedRows[msg.ts] !== undefined) {
				// User override takes priority
				decisions.set(msg.ts, { isExpanded: expandedRows[msg.ts], collapseDecision: null })
			} else {
				// Use per-type thresholds: user messages collapse sooner than assistant messages.
				// isUserMessage() checks for all user-written subtypes (user_feedback, user_feedback_diff).
				// (ask-type messages are all blocked by shouldNeverCollapse above.)
				const threshold = isUserMessage(msg) ? userThreshold : assistantThreshold
				const decision = analyzeMessage(msg, threshold)
				decisions.set(msg.ts, { isExpanded: !decision.shouldCollapse, collapseDecision: decision })
			}
		})
		return decisions
	}, [groupedMessages, expandedRows, autoCollapseLongMessages, longMessageCollapseThreshold])

	const itemContent = useCallback(
		(index: number, item: VirtuosoItem) => {
			const hasCheckpoint = modifiedMessages.some((message) => message.say === "checkpoint_saved")

			// Task activity group
			if (isTaskActivityGroup(item)) {
				const groupData = item as TaskActivityGroupData
				const groupCollapse = taskActivityGroupState[groupData.ts]
				const isActive = groupData.ts === latestGroupTs && isStreaming
				const viewModel = deriveTaskActivityViewModel(groupData.messages, isActive)
				return (
					<TaskActivityGroup
						key={`tag-${groupData.ts}`}
						viewModel={viewModel}
						messages={groupData.messages}
						isCollapsed={groupCollapse?.isCollapsed ?? false}
						onToggleCollapse={() => handleToggleTaskActivity(groupData.ts)}
						collapseDecisions={collapseDecisions}
						lastModifiedMessage={modifiedMessages.at(-1)}
						isStreamingForContent={isStreaming}
						isLastInList={index === virtuosoItems.length - 1}
						onToggleExpand={toggleRowExpansion}
						onSuggestionClick={handleSuggestionClickInRow}
						onBatchFileResponse={handleBatchFileResponse}
						onFollowUpUnmount={handleFollowUpUnmount}
						isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
						enableButtons={enableButtons}
						primaryButtonText={primaryButtonText}
						hasCheckpoint={hasCheckpoint}
						completionCheckpoint={completionCheckpoint}
						completionResultTs={completionResultTs}
						onJumpToPreviousCheckpoint={handleScrollToLatestCheckpoint}
					/>
				)
			}

			// Regular message
			const message = item as ClineMessage
			const result = collapseDecisions.get(message.ts) ?? { isExpanded: true, collapseDecision: null }

			return (
				<ChatRow
					key={message.ts}
					message={message}
					isExpanded={result.isExpanded}
					collapseDecision={result.collapseDecision}
					onToggleExpand={toggleRowExpansion} // This was already stabilized
					lastModifiedMessage={modifiedMessages.at(-1)} // Original direct access
					isLast={index === virtuosoItems.length - 1} // Original direct access
					onHeightChange={handleRowHeightChange}
					isStreaming={isStreaming}
					onSuggestionClick={handleSuggestionClickInRow} // This was already stabilized
					onBatchFileResponse={handleBatchFileResponse}
					onFollowUpUnmount={handleFollowUpUnmount}
					isFollowUpAnswered={message.isAnswered === true || message.ts === currentFollowUpTs}
					isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
					editable={
						message.type === "ask" &&
						message.ask === "tool" &&
						(() => {
							let tool: any = {}
							try {
								tool = JSON.parse(message.text || "{}")
							} catch (_) {
								if (message.text?.includes("updateTodoList")) {
									tool = { tool: "updateTodoList" }
								}
							}
							return tool.tool === "updateTodoList" && enableButtons && !!primaryButtonText
						})()
					}
					hasCheckpoint={hasCheckpoint}
					completionCheckpoint={message.ts === completionResultTs ? completionCheckpoint : undefined}
					onJumpToPreviousCheckpoint={handleScrollToLatestCheckpoint}
				/>
			)
		},
		[
			collapseDecisions,
			taskActivityGroupState,
			latestGroupTs,
			handleToggleTaskActivity,
			toggleRowExpansion,
			modifiedMessages,
			virtuosoItems.length,
			completionCheckpoint,
			completionResultTs,
			handleRowHeightChange,
			handleSuggestionClickInRow,
			handleBatchFileResponse,
			handleFollowUpUnmount,
			currentFollowUpTs,
			isFollowUpAutoApprovalPaused,
			enableButtons,
			isStreaming,
			primaryButtonText,
			handleScrollToLatestCheckpoint,
		],
	)

	const computeMessageKey = useCallback((index: number, item: VirtuosoItem) => {
		if (isTaskActivityGroup(item)) {
			return `tag-${(item as TaskActivityGroupData).ts}-${index}`
		}
		return `${(item as ClineMessage).ts}-${index}`
	}, [])

	// Function to handle mode switching
	const switchToNextMode = useCallback(() => {
		const allModes = getAllModes(customModes)
		const currentModeIndex = allModes.findIndex((m) => m.slug === mode)
		const nextModeIndex = (currentModeIndex + 1) % allModes.length
		// Update local state and notify extension to sync mode change
		switchToMode(allModes[nextModeIndex].slug)
	}, [mode, customModes, switchToMode])

	// Function to handle switching to previous mode
	const switchToPreviousMode = useCallback(() => {
		const allModes = getAllModes(customModes)
		const currentModeIndex = allModes.findIndex((m) => m.slug === mode)
		const previousModeIndex = (currentModeIndex - 1 + allModes.length) % allModes.length
		// Update local state and notify extension to sync mode change
		switchToMode(allModes[previousModeIndex].slug)
	}, [mode, customModes, switchToMode])

	// Mode switching keyboard handler. Scroll-intent keyboard detection
	// (PageUp, Home, ArrowUp) is handled by useScrollLifecycle.
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === ".") {
				event.preventDefault()
				if (event.shiftKey) {
					switchToPreviousMode()
				} else {
					switchToNextMode()
				}
			}
		},
		[switchToNextMode, switchToPreviousMode],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)

		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [handleKeyDown])

	useImperativeHandle(ref, () => ({
		acceptInput: () => {
			const hasInput = inputValue.trim() || selectedImages.length > 0

			// Special case: during command_output, queue the message instead of
			// triggering the primary button action (which would lose the message)
			if (clineAskRef.current === "command_output" && hasInput) {
				vscode.postMessage({ type: "queueMessage", text: inputValue.trim(), images: selectedImages })
				setInputValue("")
				setSelectedImages([])
				return
			}

			if (enableButtons && primaryButtonText) {
				handlePrimaryButtonClick(inputValue, selectedImages)
			} else if (!sendingDisabled && !isProfileDisabled && hasInput) {
				handleSendMessage(inputValue, selectedImages)
			}
		},
	}))

	const handleCondenseContext = (taskId: string) => {
		if (isCondensing || sendingDisabled) {
			return
		}
		setIsCondensing(true)
		setSendingDisabled(true)
		vscode.postMessage({ type: "condenseTaskContextRequest", text: taskId })
	}

	const areButtonsVisible = showScrollToBottom || primaryButtonText || secondaryButtonText

	return (
		<div
			data-testid="chat-view"
			className={isHidden ? "hidden" : "fixed top-0 left-0 right-0 bottom-0 flex flex-col overflow-hidden"}>
			{telemetrySetting === "unset" && <TelemetryBanner />}
			{(showAnnouncement || showAnnouncementModal) && (
				<Announcement
					hideAnnouncement={() => {
						if (showAnnouncementModal) {
							setShowAnnouncementModal(false)
						}
						if (showAnnouncement) {
							hideAnnouncement()
						}
					}}
				/>
			)}
			{task ? (
				<>
					<TaskHeader
						task={task}
						tokensIn={apiMetrics.totalTokensIn}
						tokensOut={apiMetrics.totalTokensOut}
						cacheWrites={apiMetrics.totalCacheWrites}
						cacheReads={apiMetrics.totalCacheReads}
						totalCost={apiMetrics.totalCost}
						aggregatedCost={
							currentTaskItem?.id && aggregatedCostsMap.has(currentTaskItem.id)
								? aggregatedCostsMap.get(currentTaskItem.id)!.totalCost
								: undefined
						}
						hasSubtasks={
							!!(
								currentTaskItem?.id &&
								aggregatedCostsMap.has(currentTaskItem.id) &&
								aggregatedCostsMap.get(currentTaskItem.id)!.childrenCost > 0
							)
						}
						parentTaskId={currentTaskItem?.parentTaskId}
						costBreakdown={
							currentTaskItem?.id && aggregatedCostsMap.has(currentTaskItem.id)
								? getCostBreakdownIfNeeded(aggregatedCostsMap.get(currentTaskItem.id)!, {
										own: t("common:costs.own"),
										subtasks: t("common:costs.subtasks"),
									})
								: undefined
						}
						contextTokens={apiMetrics.contextTokens}
						buttonsDisabled={sendingDisabled}
						handleCondenseContext={handleCondenseContext}
						todos={latestTodos}
					/>

					{checkpointWarning && (
						<div className="px-3">
							<CheckpointWarning warning={checkpointWarning} />
						</div>
					)}
				</>
			) : (
				<div className="flex flex-col h-full p-6 min-h-0 overflow-y-auto gap-4 relative">
					<div className="flex flex-col items-start gap-2 my-auto min-[400px]:px-6">
						<VersionIndicator
							onClick={() => setShowAnnouncementModal(true)}
							className="absolute top-2 right-3 z-10"
						/>
						<div className="flex flex-col gap-4 w-full">
							<RooHero />
							<RooTips />
							{/* Everyone should see their task history if any */}
							{taskHistory.length > 0 && <HistoryPreview />}
						</div>
					</div>
				</div>
			)}

			{!task && showWorktreesInHomeScreen && <WorktreeSelector />}

			{task && (
				<>
					<div className="grow flex" ref={scrollContainerRef}>
						<Virtuoso
							ref={virtuosoRef}
							key={task.ts}
							className="zoo-scrollbar grow overflow-y-scroll mb-1"
							computeItemKey={computeMessageKey}
							defaultItemHeight={CHAT_DEFAULT_ITEM_HEIGHT}
							increaseViewportBy={CHAT_VIEWPORT_BUFFER}
							data={virtuosoItems}
							itemContent={itemContent}
							followOutput={followOutputCallback}
							atBottomStateChange={atBottomStateChangeCallback}
							atBottomThreshold={10}
						/>
					</div>
					<FileChangesPanel clineMessages={messages} />
					{areButtonsVisible && (
						<div
							className={`flex h-9 items-center mb-1 px-[15px] ${
								showScrollToBottom ? "opacity-100" : enableButtons ? "opacity-100" : "opacity-50"
							}`}>
							{showScrollToBottom ? (
								<>
									<StandardTooltip content={t("chat:scrollToBottom")}>
										<Button
											variant="secondary"
											className={hasLatestCheckpoint ? "flex-1 mr-[6px]" : "flex-[2]"}
											onClick={handleScrollToBottomAndResetCheckpointCursor}>
											<span className="codicon codicon-chevron-down"></span>
										</Button>
									</StandardTooltip>
									{hasLatestCheckpoint && (
										<StandardTooltip content={t("chat:scrollToLatestCheckpoint")}>
											<Button
												variant="secondary"
												className="flex-1 ml-[6px]"
												onClick={handleScrollToLatestCheckpoint}
												aria-label={t("chat:scrollToLatestCheckpoint")}>
												<span className="codicon codicon-history"></span>
											</Button>
										</StandardTooltip>
									)}
								</>
							) : (
								<>
									{primaryButtonText && (
										<StandardTooltip
											content={
												primaryButtonText === t("chat:retry.title")
													? t("chat:retry.tooltip")
													: primaryButtonText === t("chat:save.title")
														? t("chat:save.tooltip")
														: primaryButtonText === t("chat:approve.title")
															? t("chat:approve.tooltip")
															: primaryButtonText === t("chat:runCommand.title")
																? t("chat:runCommand.tooltip")
																: primaryButtonText === t("chat:startNewTask.title")
																	? t("chat:startNewTask.tooltip")
																	: primaryButtonText === t("chat:resumeTask.title")
																		? t("chat:resumeTask.tooltip")
																		: primaryButtonText ===
																			  t("chat:proceedAnyways.title")
																			? t("chat:proceedAnyways.tooltip")
																			: primaryButtonText ===
																				  t("chat:proceedWhileRunning.title")
																				? t("chat:proceedWhileRunning.tooltip")
																				: undefined
											}>
											<Button
												variant="primary"
												disabled={!enableButtons}
												className={secondaryButtonText ? "flex-1 mr-[6px]" : "flex-[2] mr-0"}
												onClick={() => handlePrimaryButtonClick(inputValue, selectedImages)}>
												{primaryButtonText}
											</Button>
										</StandardTooltip>
									)}
									{secondaryButtonText && (
										<StandardTooltip
											content={
												secondaryButtonText === t("chat:startNewTask.title")
													? t("chat:startNewTask.tooltip")
													: secondaryButtonText === t("chat:reject.title")
														? t("chat:reject.tooltip")
														: secondaryButtonText === t("chat:terminate.title")
															? t("chat:terminate.tooltip")
															: secondaryButtonText === t("chat:killCommand.title")
																? t("chat:killCommand.tooltip")
																: undefined
											}>
											<Button
												variant="secondary"
												disabled={!enableButtons}
												className="flex-1 ml-[6px]"
												onClick={() => handleSecondaryButtonClick(inputValue, selectedImages)}>
												{secondaryButtonText}
											</Button>
										</StandardTooltip>
									)}
								</>
							)}
						</div>
					)}
				</>
			)}

			<QueuedMessages
				queue={messageQueue}
				onRemove={(index) => {
					if (messageQueue[index]) {
						vscode.postMessage({ type: "removeQueuedMessage", text: messageQueue[index].id })
					}
				}}
				onUpdate={(index, newText) => {
					if (messageQueue[index]) {
						vscode.postMessage({
							type: "editQueuedMessage",
							payload: { id: messageQueue[index].id, text: newText, images: messageQueue[index].images },
						})
					}
				}}
			/>
			{showRetiredProviderWarning && (
				<div className="px-[15px] py-1">
					<WarningRow
						title={t("chat:retiredProvider.title")}
						message={t("chat:retiredProvider.message")}
						actionText={t("chat:retiredProvider.openSettings")}
						onAction={() => vscode.postMessage({ type: "switchTab", tab: "settings" })}
					/>
				</div>
			)}
			<ChatTextArea
				ref={textAreaRef}
				inputValue={inputValue}
				setInputValue={setInputValue}
				sendingDisabled={sendingDisabled || isProfileDisabled}
				selectApiConfigDisabled={sendingDisabled && clineAsk !== "api_req_failed"}
				placeholderText={placeholderText}
				selectedImages={selectedImages}
				setSelectedImages={setSelectedImages}
				onSend={() => handleSendMessage(inputValue, selectedImages)}
				onSelectImages={selectImages}
				shouldDisableImages={shouldDisableImages}
				onHeightChange={() => {
					if (isAtBottomRef.current && scrollPhaseRef.current !== "USER_BROWSING_HISTORY") {
						scrollToBottomAuto()
					}
				}}
				mode={mode}
				setMode={setMode}
				modeShortcutText={modeShortcutText}
				isStreaming={isStreaming}
				onStop={handleStopTask}
				onEnqueueMessage={handleEnqueueCurrentMessage}
			/>

			{isProfileDisabled && (
				<div className="px-3">
					<ProfileViolationWarning />
				</div>
			)}

			<div id="roo-portal" />
		</div>
	)
}

const ChatView = forwardRef(ChatViewComponent)

export default ChatView
