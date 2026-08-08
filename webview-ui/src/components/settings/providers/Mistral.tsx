import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings, type RouterModels, mistralDefaultModelId } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { ApiKeyInput } from "@src/components/ui"

import { inputEventTransform } from "../transforms"

type MistralProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	simplifySettings?: boolean
}

export const Mistral = ({ apiConfiguration, setApiConfigurationField }: MistralProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	return (
		<>
			<ApiKeyInput
				value={apiConfiguration?.mistralApiKey || ""}
				onInput={handleInputChange("mistralApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				label={<span className="font-medium">{t("settings:providers.mistralApiKey")}</span>}
				className="w-full"
	/>
			{!apiConfiguration?.mistralApiKey && (
				<VSCodeButtonLink href="https://console.mistral.ai/" appearance="secondary">
					{t("settings:providers.getMistralApiKey")}
				</VSCodeButtonLink>
			)}
			{(apiConfiguration?.apiModelId?.startsWith("codestral-") ||
				(!apiConfiguration?.apiModelId && mistralDefaultModelId.startsWith("codestral-"))) && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.mistralCodestralUrl || ""}
						type="url"
						onInput={handleInputChange("mistralCodestralUrl")}
						placeholder="https://codestral.mistral.ai"
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.codestralBaseUrl")}</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.codestralBaseUrlDesc")}
					</div>
				</>
			)}
		</>
	)
}
