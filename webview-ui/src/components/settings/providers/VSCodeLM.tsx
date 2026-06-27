import { useState, useCallback, useMemo } from "react"
import { useEvent } from "react-use"
import type { ProviderSettings, ExtensionMessage, ModelInfo, LanguageModelChatSelector } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"

import { ModelPicker } from "../ModelPicker"

type VSCodeLMProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const VSCodeLM = ({ apiConfiguration, setApiConfigurationField }: VSCodeLMProps) => {
	const { t } = useAppTranslation()

	const [vsCodeLmModels, setVsCodeLmModels] = useState<LanguageModelChatSelector[]>([])

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "vsCodeLmModels":
				{
					const newModels = message.vsCodeLmModels ?? []
					setVsCodeLmModels(newModels)
				}
				break
		}
	}, [])

	useEvent("message", onMessage)

	const getModelKey = useCallback((model: LanguageModelChatSelector): string => {
		return model.id ?? [model.vendor, model.family, model.version].filter(Boolean).join("/")
	}, [])

	// Convert VSCode LM models array to Record format for ModelPicker
	const modelsRecord = useMemo((): Record<string, ModelInfo> => {
		return vsCodeLmModels.reduce(
			(acc, model) => {
				const modelId = getModelKey(model)
				acc[modelId] = model.info ?? {
					maxTokens: 0,
					contextWindow: 0,
					supportsPromptCache: false,
					description: `${model.vendor} - ${model.family}`,
				}
				return acc
			},
			{} as Record<string, ModelInfo>,
		)
	}, [getModelKey, vsCodeLmModels])

	// Transform string model ID to a persisted selector, preserving extension-provided model capabilities.
	const valueTransform = useCallback(
		(modelId: string) => {
			const selectedModel = vsCodeLmModels.find((model) => getModelKey(model) === modelId)
			if (selectedModel) {
				return selectedModel
			}

			const [vendor, family, version] = modelId.split("/")
			return { id: modelId, vendor, family, version }
		},
		[getModelKey, vsCodeLmModels],
	)

	// Transform stored selector object back to display string
	const displayTransform = useCallback(
		(value: unknown) => {
			if (!value) return ""
			return getModelKey(value as LanguageModelChatSelector)
		},
		[getModelKey],
	)

	return (
		<>
			{vsCodeLmModels.length > 0 ? (
				<ModelPicker
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					defaultModelId=""
					models={modelsRecord}
					modelIdKey="vsCodeLmModelSelector"
					serviceName="VS Code LM"
					serviceUrl="https://code.visualstudio.com/api/extension-guides/language-model"
					valueTransform={valueTransform}
					displayTransform={displayTransform}
					hidePricing
				/>
			) : (
				<div>
					<label className="block font-medium mb-1">{t("settings:providers.vscodeLmModel")}</label>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.vscodeLmDescription")}
					</div>
				</div>
			)}
			<div className="text-sm text-vscode-errorForeground">{t("settings:providers.vscodeLmWarning")}</div>
		</>
	)
}
