import { useState, useCallback, useEffect } from "react"
import { useEvent } from "react-use"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type ModelInfo,
	type ExtensionMessage,
	type ResolvedModelCapabilities,
	type OrganizationAllowList,
	openAiModelInfoSaneDefaults,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip } from "@src/components/ui"
import { vscode } from "@src/utils/vscode"

import { ModelPicker } from "../ModelPicker"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@src/components/ui"

type CustomEndpointProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	organizationAllowList: OrganizationAllowList
	selectedModelCapabilities?: ResolvedModelCapabilities
	modelValidationError?: string
	simplifySettings?: boolean
}

export const CustomEndpoint = ({
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	selectedModelCapabilities,
	modelValidationError,
	simplifySettings,
}: CustomEndpointProps) => {
	const { t } = useAppTranslation()

	const [discoveredModels, setDiscoveredModels] = useState<Record<string, ModelInfo> | null>(null)

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(field: K, transform?: (event: E) => ProviderSettings[K]) =>
			(event: E | Event) => {
				if (transform) {
					setApiConfigurationField(field, transform(event as E))
				} else {
					setApiConfigurationField(field, (event as { target: HTMLInputElement }).target.value as any)
				}
			},
		[setApiConfigurationField],
	)

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "openAiModels": {
				const updatedModels = message.openAiModels ?? []
				setDiscoveredModels(
					Object.fromEntries(updatedModels.map((item) => [item, openAiModelInfoSaneDefaults])),
				)
				break
			}
		}
	}, [])

	useEvent("message", onMessage)

	// Request models when base URL or API key changes
	useEffect(() => {
		const timer = setTimeout(() => {
			if (apiConfiguration?.customEndpointBaseUrl) {
				vscode.postMessage({
					type: "requestOpenAiModels",
					values: {
						baseUrl: apiConfiguration.customEndpointBaseUrl,
						apiKey: apiConfiguration.customEndpointApiKey,
						customHeaders: {},
						openAiHeaders: {},
					},
				})
			}
		}, 500)

		return () => clearTimeout(timer)
	}, [apiConfiguration?.customEndpointBaseUrl, apiConfiguration?.customEndpointApiKey])

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.customEndpointBaseUrl || ""}
				type="url"
				onInput={handleInputChange("customEndpointBaseUrl")}
				placeholder={t("settings:placeholders.baseUrl")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.customEndpoint.baseUrl")}</label>
			</VSCodeTextField>

			<VSCodeTextField
				value={apiConfiguration?.customEndpointApiKey || ""}
				type="password"
				onInput={handleInputChange("customEndpointApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.customEndpoint.apiKey")}</label>
			</VSCodeTextField>

			<div>
				<label className="block font-medium mb-1">{t("settings:providers.customEndpoint.format")}</label>
				<Select
					value={apiConfiguration?.customEndpointFormat || "openai"}
					onValueChange={(value) => setApiConfigurationField("customEndpointFormat", value as any)}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder={t("settings:common.select")} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="openai">OpenAI Compatible</SelectItem>
						<SelectItem value="anthropic">Anthropic Compatible</SelectItem>
						<SelectItem value="custom">Custom</SelectItem>
					</SelectContent>
				</Select>
				<div className="text-sm text-vscode-descriptionForeground mt-1">
					{t("settings:providers.customEndpoint.formatDescription")}
				</div>
			</div>

			<div className="flex gap-2">
				<div className="flex-1">
					<VSCodeTextField
						value={apiConfiguration?.customEndpointApiKeyHeader || ""}
						onInput={handleInputChange("customEndpointApiKeyHeader")}
						placeholder={t("settings:placeholders.apiKeyHeader")}
						className="w-full">
						<label className="block font-medium mb-1">
							{t("settings:providers.customEndpoint.apiKeyHeader")}
						</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.customEndpoint.apiKeyHeaderDescription")}
					</div>
				</div>
				<div className="flex-1">
					<VSCodeTextField
						value={apiConfiguration?.customEndpointApiKeyPrefix || ""}
						onInput={handleInputChange("customEndpointApiKeyPrefix")}
						placeholder={t("settings:placeholders.apiKeyPrefix")}
						className="w-full">
						<label className="block font-medium mb-1">
							{t("settings:providers.customEndpoint.apiKeyPrefix")}
						</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.customEndpoint.apiKeyPrefixDescription")}
					</div>
				</div>
			</div>

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				selectedModelCapabilities={selectedModelCapabilities}
				defaultModelId={apiConfiguration?.customEndpointModelId || ""}
				models={discoveredModels}
				modelIdKey="customEndpointModelId"
				serviceName="Custom Endpoint"
				serviceUrl={apiConfiguration?.customEndpointBaseUrl || ""}
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>

			<div className="flex flex-col gap-3">
				<div className="text-sm text-vscode-descriptionForeground whitespace-pre-line">
					{t("settings:providers.customEndpoint.capabilities")}
				</div>

				<div>
					<VSCodeTextField
						value={(() => {
							const v = apiConfiguration?.customEndpointModelInfo?.maxTokens
							return v && v > 0 ? v.toString() : ""
						})()}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.customEndpointModelInfo?.maxTokens
								if (!value) {
									return "var(--vscode-input-border)"
								}
								return value > 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onInput={handleInputChange("customEndpointModelInfo", (e) => {
							const value = parseInt((e.target as HTMLInputElement).value)
							return {
								...(apiConfiguration?.customEndpointModelInfo || openAiModelInfoSaneDefaults),
								maxTokens: isNaN(value) ? undefined : value,
							}
						})}
						placeholder={t("settings:placeholders.numbers.maxTokens")}
						className="w-full">
						<label className="block font-medium mb-1">
							{t("settings:providers.customModel.maxTokens.label")}
						</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.customModel.maxTokens.description")}
					</div>
				</div>

				<div>
					<VSCodeTextField
						value={(() => {
							const v = apiConfiguration?.customEndpointModelInfo?.contextWindow
							return v && v > 0 ? v.toString() : ""
						})()}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.customEndpointModelInfo?.contextWindow
								if (!value) {
									return "var(--vscode-input-border)"
								}
								return value > 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onInput={handleInputChange("customEndpointModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseInt(value)
							return {
								...(apiConfiguration?.customEndpointModelInfo || openAiModelInfoSaneDefaults),
								contextWindow: isNaN(parsed) ? 0 : parsed,
							}
						})}
						placeholder={t("settings:placeholders.numbers.contextWindow")}
						className="w-full">
						<label className="block font-medium mb-1">
							{t("settings:providers.customModel.contextWindow.label")}
						</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.customModel.contextWindow.description")}
					</div>
				</div>

				<div>
					<div className="flex items-center gap-1">
						<input
							type="checkbox"
							checked={
								apiConfiguration?.customEndpointModelInfo?.supportsImages ??
								openAiModelInfoSaneDefaults.supportsImages
							}
							onChange={(e) => {
								setApiConfigurationField("customEndpointModelInfo", {
									...(apiConfiguration?.customEndpointModelInfo || openAiModelInfoSaneDefaults),
									supportsImages: e.target.checked,
								})
							}}
						/>
						<span className="font-medium">{t("settings:providers.customModel.imageSupport.label")}</span>
						<StandardTooltip content={t("settings:providers.customModel.imageSupport.description")}>
							<i
								className="codicon codicon-info text-vscode-descriptionForeground"
								style={{ fontSize: "12px" }}
							/>
						</StandardTooltip>
					</div>
					<div className="text-sm text-vscode-descriptionForeground pt-1">
						{t("settings:providers.customModel.imageSupport.description")}
					</div>
				</div>

				<div>
					<div className="flex items-center gap-1">
						<input
							type="checkbox"
							checked={apiConfiguration?.customEndpointModelInfo?.supportsPromptCache ?? false}
							onChange={(e) => {
								setApiConfigurationField("customEndpointModelInfo", {
									...(apiConfiguration?.customEndpointModelInfo || openAiModelInfoSaneDefaults),
									supportsPromptCache: e.target.checked,
								})
							}}
						/>
						<span className="font-medium">{t("settings:providers.customModel.promptCache.label")}</span>
						<StandardTooltip content={t("settings:providers.customModel.promptCache.description")}>
							<i
								className="codicon codicon-info text-vscode-descriptionForeground"
								style={{ fontSize: "12px" }}
							/>
						</StandardTooltip>
					</div>
					<div className="text-sm text-vscode-descriptionForeground pt-1">
						{t("settings:providers.customModel.promptCache.description")}
					</div>
				</div>

				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.customEndpointModelInfo?.inputPrice?.toString() ??
							openAiModelInfoSaneDefaults.inputPrice?.toString() ??
							""
						}
						type="text"
						onChange={handleInputChange("customEndpointModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseFloat(value)
							return {
								...(apiConfiguration?.customEndpointModelInfo ?? openAiModelInfoSaneDefaults),
								inputPrice: isNaN(parsed) ? openAiModelInfoSaneDefaults.inputPrice : parsed,
							}
						})}
						placeholder={t("settings:placeholders.numbers.inputPrice")}
						className="w-full">
						<div className="flex items-center gap-1">
							<label className="block font-medium mb-1">
								{t("settings:providers.customModel.pricing.input.label")}
							</label>
							<StandardTooltip content={t("settings:providers.customModel.pricing.input.description")}>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									style={{ fontSize: "12px" }}
								/>
							</StandardTooltip>
						</div>
					</VSCodeTextField>
				</div>

				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.customEndpointModelInfo?.outputPrice?.toString() ||
							openAiModelInfoSaneDefaults.outputPrice?.toString() ||
							""
						}
						type="text"
						onChange={handleInputChange("customEndpointModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseFloat(value)
							return {
								...(apiConfiguration?.customEndpointModelInfo || openAiModelInfoSaneDefaults),
								outputPrice: isNaN(parsed) ? openAiModelInfoSaneDefaults.outputPrice : parsed,
							}
						})}
						placeholder={t("settings:placeholders.numbers.outputPrice")}
						className="w-full">
						<div className="flex items-center gap-1">
							<label className="block font-medium mb-1">
								{t("settings:providers.customModel.pricing.output.label")}
							</label>
							<StandardTooltip content={t("settings:providers.customModel.pricing.output.description")}>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									style={{ fontSize: "12px" }}
								/>
							</StandardTooltip>
						</div>
					</VSCodeTextField>
				</div>

				<Button
					variant="secondary"
					onClick={() => setApiConfigurationField("customEndpointModelInfo", openAiModelInfoSaneDefaults)}>
					{t("settings:providers.customModel.resetDefaults")}
				</Button>
			</div>
		</>
	)
}
