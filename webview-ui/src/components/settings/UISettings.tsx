import { HTMLAttributes, useMemo } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { telemetryClient } from "@/utils/TelemetryClient"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { Slider, Button } from "../ui"
import { ExtensionStateContextType } from "@/context/ExtensionStateContext"

export const CHAT_FONT_SIZE_MIN = 8
export const CHAT_FONT_SIZE_MAX = 32
export const CHAT_FONT_SIZE_DEFAULT = 13

interface UISettingsProps extends HTMLAttributes<HTMLDivElement> {
	reasoningBlockCollapsed: boolean
	enterBehavior: "send" | "newline"
	chatFontSize?: number
	autoCloseZooOpenedFiles?: boolean
	autoCloseZooOpenedFilesAfterUserEdited?: boolean
	autoCloseZooOpenedNewFiles?: boolean
	autoCollapseLongMessages?: boolean
	longMessageCollapseThreshold?: number
	setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType>
}

export const UISettings = ({
	reasoningBlockCollapsed,
	enterBehavior,
	chatFontSize,
	autoCloseZooOpenedFiles,
	autoCloseZooOpenedFilesAfterUserEdited,
	autoCloseZooOpenedNewFiles,
	autoCollapseLongMessages,
	longMessageCollapseThreshold,
	setCachedStateField,
	...props
}: UISettingsProps) => {
	const { t } = useAppTranslation()

	// Detect platform for dynamic modifier key display
	const primaryMod = useMemo(() => {
		const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
		return isMac ? "⌘" : "Ctrl"
	}, [])

	const handleReasoningBlockCollapsedChange = (value: boolean) => {
		setCachedStateField("reasoningBlockCollapsed", value)

		// Track telemetry event
		telemetryClient.capture("ui_settings_collapse_thinking_changed", {
			enabled: value,
		})
	}

	const handleEnterBehaviorChange = (requireCtrlEnter: boolean) => {
		const newBehavior = requireCtrlEnter ? "newline" : "send"
		setCachedStateField("enterBehavior", newBehavior)

		// Track telemetry event
		telemetryClient.capture("ui_settings_enter_behavior_changed", {
			behavior: newBehavior,
		})
	}

	const handleChatFontSizeChange = (value: number) => {
		setCachedStateField("chatFontSize", value)

		// Track telemetry event
		telemetryClient.capture("ui_settings_chat_font_size_changed", {
			value,
		})
	}

	const handleChatFontSizeReset = () => {
		setCachedStateField("chatFontSize", undefined)

		// Track telemetry event
		telemetryClient.capture("ui_settings_chat_font_size_reset")
	}

	const handleAutoCollapseChange = (checked: boolean) => {
		setCachedStateField("autoCollapseLongMessages", checked)
	}

	const handleThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = e.target.value
		if (raw === "") {
			setCachedStateField("longMessageCollapseThreshold", undefined)
			return
		}
		const value = parseInt(raw, 10)
		if (!isNaN(value)) {
			// Clamp to valid range
			const clamped = Math.max(5, Math.min(500, value))
			setCachedStateField("longMessageCollapseThreshold", clamped)
		}
	}

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.ui")}</SectionHeader>

			<Section>
				<div className="space-y-6">
					{/* Collapse Thinking Messages Setting */}
					<SearchableSetting
						settingId="ui-collapse-thinking"
						section="ui"
						label={t("settings:ui.collapseThinking.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={reasoningBlockCollapsed}
								onChange={(e: any) => handleReasoningBlockCollapsedChange(e.target.checked)}
								data-testid="collapse-thinking-checkbox">
								<span className="font-medium">{t("settings:ui.collapseThinking.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.collapseThinking.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Enter Key Behavior Setting */}
					<SearchableSetting
						settingId="ui-enter-behavior"
						section="ui"
						label={t("settings:ui.requireCtrlEnterToSend.label", { primaryMod })}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={enterBehavior === "newline"}
								onChange={(e: any) => handleEnterBehaviorChange(e.target.checked)}
								data-testid="enter-behavior-checkbox">
								<span className="font-medium">
									{t("settings:ui.requireCtrlEnterToSend.label", { primaryMod })}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.requireCtrlEnterToSend.description", { primaryMod })}
							</div>
						</div>
					</SearchableSetting>

					{/* Chat Font Size Setting */}
					<SearchableSetting
						settingId="ui-chat-font-size"
						section="ui"
						label={t("settings:ui.chatFontSize.label")}>
						<div className="flex flex-col gap-1">
							<label className="block font-medium mb-1">{t("settings:ui.chatFontSize.label")}</label>
							<div className="flex items-center gap-2">
								<Slider
									min={CHAT_FONT_SIZE_MIN}
									max={CHAT_FONT_SIZE_MAX}
									step={1}
									value={[chatFontSize ?? CHAT_FONT_SIZE_DEFAULT]}
									onValueChange={([value]) => handleChatFontSizeChange(value)}
									data-testid="chat-font-size-slider"
								/>
								<span className="w-12 text-right">{chatFontSize ?? CHAT_FONT_SIZE_DEFAULT}px</span>
								<Button
									variant="secondary"
									size="sm"
									disabled={chatFontSize === undefined}
									onClick={handleChatFontSizeReset}
									data-testid="chat-font-size-reset">
									{t("settings:ui.chatFontSize.reset")}
								</Button>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:ui.chatFontSize.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Auto-close Zoo opened files */}
					<SearchableSetting
						settingId="ui-auto-close-zoo-opened-files"
						section="ui"
						label={t("settings:ui.autoCloseZooOpenedFiles.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={autoCloseZooOpenedFiles ?? true}
								onChange={(e: any) => setCachedStateField("autoCloseZooOpenedFiles", e.target.checked)}
								data-testid="auto-close-zoo-opened-files-checkbox">
								<span className="font-medium">{t("settings:ui.autoCloseZooOpenedFiles.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.autoCloseZooOpenedFiles.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Auto-close Zoo opened files after user interaction */}
					<SearchableSetting
						settingId="ui-auto-close-zoo-opened-files-after-user-edited"
						section="ui"
						label={t("settings:ui.autoCloseZooOpenedFilesAfterUserEdited.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={autoCloseZooOpenedFilesAfterUserEdited ?? false}
								onChange={(e: any) =>
									setCachedStateField("autoCloseZooOpenedFilesAfterUserEdited", e.target.checked)
								}
								data-testid="auto-close-zoo-opened-files-after-user-edited-checkbox">
								<span className="font-medium">
									{t("settings:ui.autoCloseZooOpenedFilesAfterUserEdited.label")}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.autoCloseZooOpenedFilesAfterUserEdited.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Auto-close Zoo opened new files */}
					<SearchableSetting
						settingId="ui-auto-close-zoo-opened-new-files"
						section="ui"
						label={t("settings:ui.autoCloseZooOpenedNewFiles.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={autoCloseZooOpenedNewFiles ?? false}
								onChange={(e: any) =>
									setCachedStateField("autoCloseZooOpenedNewFiles", e.target.checked)
								}
								data-testid="auto-close-zoo-opened-new-files-checkbox">
								<span className="font-medium">{t("settings:ui.autoCloseZooOpenedNewFiles.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.autoCloseZooOpenedNewFiles.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Auto-collapse long messages */}
					<SearchableSetting
						settingId="ui-auto-collapse-long-messages"
						section="ui"
						label={t("settings:ui.autoCollapseLongMessages.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={autoCollapseLongMessages ?? true}
								onChange={(e: any) => handleAutoCollapseChange(e.target.checked)}
								data-testid="auto-collapse-long-messages-checkbox">
								<span className="font-medium">{t("settings:ui.autoCollapseLongMessages.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.autoCollapseLongMessages.description")}
							</div>
							{(autoCollapseLongMessages ?? true) && (
								<div className="ml-5 mt-2 flex items-center gap-2">
									<label
										htmlFor="auto-collapse-threshold"
										className="text-sm text-vscode-descriptionForeground">
										{t("settings:ui.autoCollapseLongMessages.threshold.label")}
									</label>
									<input
										id="auto-collapse-threshold"
										type="number"
										min={5}
										max={500}
										value={longMessageCollapseThreshold ?? 10}
										onChange={handleThresholdChange}
										className="w-20 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-0.5 text-sm"
										data-testid="auto-collapse-threshold-input"
									/>
								</div>
							)}
							{(autoCollapseLongMessages ?? true) && (
								<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
									{t("settings:ui.autoCollapseLongMessages.threshold.description")}
								</div>
							)}
						</div>
					</SearchableSetting>
				</div>
			</Section>
		</div>
	)
}
