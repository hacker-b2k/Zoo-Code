import { useCallback } from "react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { ApiKeyInput } from "@src/components/ui"

import { inputEventTransform } from "../transforms"

type BasetenProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
}

export const Baseten = ({ apiConfiguration, setApiConfigurationField }: BasetenProps) => {
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
				value={apiConfiguration?.basetenApiKey || ""}
				onInput={handleInputChange("basetenApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				label={<label className="block font-medium mb-1">{t("settings:providers.basetenApiKey")}</label>}
				className="w-full"
	/>
			{!apiConfiguration?.basetenApiKey && (
				<VSCodeButtonLink href="https://app.baseten.co/settings/api_keys" appearance="secondary">
					{t("settings:providers.getBasetenApiKey")}
				</VSCodeButtonLink>
			)}
		</>
	)
}
