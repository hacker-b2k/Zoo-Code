import { useCallback } from "react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { ApiKeyInput } from "@src/components/ui"

import { inputEventTransform } from "../transforms"

type SambaNovaProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const SambaNova = ({ apiConfiguration, setApiConfigurationField }: SambaNovaProps) => {
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
				value={apiConfiguration?.sambaNovaApiKey || ""}
				onInput={handleInputChange("sambaNovaApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				label={<label className="block font-medium mb-1">{t("settings:providers.sambaNovaApiKey")}</label>}
				className="w-full"
			/>
			{!apiConfiguration?.sambaNovaApiKey && (
				<VSCodeButtonLink
					href="https://cloud.sambanova.ai/?utm_source=roocode&utm_medium=external&utm_campaign=cloud_signup"
					appearance="secondary">
					{t("settings:providers.getSambaNovaApiKey")}
				</VSCodeButtonLink>
			)}
		</>
	)
}
