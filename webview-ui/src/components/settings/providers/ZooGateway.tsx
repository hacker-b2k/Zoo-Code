import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type OrganizationAllowList,
	type RouterModels,
	zooGatewayDefaultModelId,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

type ZooGatewayProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	simplifySettings?: boolean
}

export const ZooGateway = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	organizationAllowList,
	modelValidationError,
	simplifySettings,
}: ZooGatewayProps) => {
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
			{/* Zoo Gateway uses zooSessionToken for auth, set automatically on login.
			    We still expose it here so users can inspect/override it if needed. */}
			<VSCodeTextField
				value={apiConfiguration?.zooSessionToken || ""}
				type="password"
				onInput={handleInputChange("zooSessionToken")}
				placeholder={t("settings:placeholders.sessionToken")}
				className="w-full">
				<label className="block font-medium mb-1">Zoo Session Token</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={zooGatewayDefaultModelId}
				models={routerModels?.["zoo-gateway"] ?? {}}
				modelIdKey="zooGatewayModelId"
				serviceName="Zoo Gateway"
				serviceUrl="https://zoocode.dev/dashboard"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>
		</>
	)
}
