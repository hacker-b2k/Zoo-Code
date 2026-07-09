import { HTMLAttributes } from "react"

import type {
	CustomImageProviderConfig,
	Experiments,
	ImageGenerationApiMethod,
	ImageGenerationProvider,
	VertexImageAuthMode,
} from "@roo-code/types"

import { EXPERIMENT_IDS, experimentConfigsMap } from "@roo/experiments"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

import { SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { ExperimentalFeature } from "./ExperimentalFeature"
import { ImageGenerationSettings } from "./ImageGenerationSettings"
import { CustomToolsSettings } from "./CustomToolsSettings"

type ExperimentalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	experiments: Experiments
	setExperimentEnabled: SetExperimentEnabled
	apiConfiguration?: any
	setApiConfigurationField?: any
	imageGenerationProvider?: ImageGenerationProvider
	imageGenerationBaseUrl?: string
	imageGenerationApiKey?: string
	imageGenerationHeaders?: Record<string, string>
	imageGenerationSelectedModel?: string
	imageGenerationApiMethod?: ImageGenerationApiMethod
	imageGenerationCustomProvider?: CustomImageProviderConfig
	vertexImageProjectId?: string
	vertexImageRegion?: string
	vertexImageModel?: string
	vertexImageAuthMode?: VertexImageAuthMode
	vertexImageAccessToken?: string
	vertexImageServiceAccountJson?: string
	setImageGenerationProvider?: (provider: ImageGenerationProvider) => void
	setImageGenerationBaseUrl?: (baseUrl: string) => void
	setImageGenerationApiKey?: (apiKey: string) => void
	setImageGenerationHeaders?: (headers: Record<string, string>) => void
	setImageGenerationSelectedModel?: (model: string) => void
	setImageGenerationApiMethod?: (apiMethod: ImageGenerationApiMethod) => void
	setImageGenerationCustomProvider?: (customProvider: CustomImageProviderConfig) => void
	setVertexImageProjectId?: (projectId: string) => void
	setVertexImageRegion?: (region: string) => void
	setVertexImageModel?: (model: string) => void
	setVertexImageAuthMode?: (authMode: VertexImageAuthMode) => void
	setVertexImageAccessToken?: (accessToken: string) => void
	setVertexImageServiceAccountJson?: (serviceAccountJson: string) => void
}

export const ExperimentalSettings = ({
	experiments,
	setExperimentEnabled,
	apiConfiguration,
	setApiConfigurationField,
	imageGenerationProvider,
	imageGenerationBaseUrl,
	imageGenerationApiKey,
	imageGenerationHeaders,
	imageGenerationSelectedModel,
	imageGenerationApiMethod,
	imageGenerationCustomProvider,
	vertexImageProjectId,
	vertexImageRegion,
	vertexImageModel,
	vertexImageAuthMode,
	vertexImageAccessToken,
	vertexImageServiceAccountJson,
	setImageGenerationProvider,
	setImageGenerationBaseUrl,
	setImageGenerationApiKey,
	setImageGenerationHeaders,
	setImageGenerationSelectedModel,
	setImageGenerationApiMethod,
	setImageGenerationCustomProvider,
	setVertexImageProjectId,
	setVertexImageRegion,
	setVertexImageModel,
	setVertexImageAuthMode,
	setVertexImageAccessToken,
	setVertexImageServiceAccountJson,
	className,
	...props
}: ExperimentalSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.experimental")}</SectionHeader>

			<Section>
				{Object.entries(experimentConfigsMap)
					.filter(([key]) => key in EXPERIMENT_IDS)
					.filter(([, config]) => config.showInSettings !== false)
					.map((config) => {
						// Use the same translation key pattern as ExperimentalFeature
						const experimentKey = config[0]
						const label = t(`settings:experimental.${experimentKey}.name`)

						if (
							config[0] === "IMAGE_GENERATION" &&
							setImageGenerationProvider &&
							setImageGenerationBaseUrl &&
							setImageGenerationApiKey &&
							setImageGenerationHeaders &&
							setImageGenerationSelectedModel &&
							setImageGenerationApiMethod &&
							setImageGenerationCustomProvider &&
							setVertexImageProjectId &&
							setVertexImageRegion &&
							setVertexImageModel &&
							setVertexImageAuthMode &&
							setVertexImageAccessToken &&
							setVertexImageServiceAccountJson
						) {
							return (
								<SearchableSetting
									key={config[0]}
									settingId={`experimental-${config[0].toLowerCase()}`}
									section="experimental"
									label={label}>
									<ImageGenerationSettings
										enabled={experiments[EXPERIMENT_IDS.IMAGE_GENERATION] ?? false}
										onChange={(enabled) =>
											setExperimentEnabled(EXPERIMENT_IDS.IMAGE_GENERATION, enabled)
										}
										imageGenerationProvider={imageGenerationProvider}
										imageGenerationBaseUrl={imageGenerationBaseUrl}
										imageGenerationApiKey={imageGenerationApiKey}
										imageGenerationHeaders={imageGenerationHeaders}
										imageGenerationSelectedModel={imageGenerationSelectedModel}
										imageGenerationApiMethod={imageGenerationApiMethod}
										imageGenerationCustomProvider={imageGenerationCustomProvider}
										vertexImageProjectId={vertexImageProjectId}
										vertexImageRegion={vertexImageRegion}
										vertexImageModel={vertexImageModel}
										vertexImageAuthMode={vertexImageAuthMode}
										vertexImageAccessToken={vertexImageAccessToken}
										vertexImageServiceAccountJson={vertexImageServiceAccountJson}
										setImageGenerationProvider={setImageGenerationProvider}
										setImageGenerationBaseUrl={setImageGenerationBaseUrl}
										setImageGenerationApiKey={setImageGenerationApiKey}
										setImageGenerationHeaders={setImageGenerationHeaders}
										setImageGenerationSelectedModel={setImageGenerationSelectedModel}
										setImageGenerationApiMethod={setImageGenerationApiMethod}
										setImageGenerationCustomProvider={setImageGenerationCustomProvider}
										setVertexImageProjectId={setVertexImageProjectId}
										setVertexImageRegion={setVertexImageRegion}
										setVertexImageModel={setVertexImageModel}
										setVertexImageAuthMode={setVertexImageAuthMode}
										setVertexImageAccessToken={setVertexImageAccessToken}
										setVertexImageServiceAccountJson={setVertexImageServiceAccountJson}
									/>
								</SearchableSetting>
							)
						}
						if (config[0] === "CUSTOM_TOOLS") {
							return (
								<SearchableSetting
									key={config[0]}
									settingId={`experimental-${config[0].toLowerCase()}`}
									section="experimental"
									label={label}>
									<CustomToolsSettings
										enabled={experiments[EXPERIMENT_IDS.CUSTOM_TOOLS] ?? false}
										onChange={(enabled) =>
											setExperimentEnabled(EXPERIMENT_IDS.CUSTOM_TOOLS, enabled)
										}
									/>
								</SearchableSetting>
							)
						}
						return (
							<SearchableSetting
								key={config[0]}
								settingId={`experimental-${config[0].toLowerCase()}`}
								section="experimental"
								label={label}>
								<ExperimentalFeature
									experimentKey={config[0]}
									enabled={
										experiments[EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS]] ?? false
									}
									onChange={(enabled) =>
										setExperimentEnabled(
											EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS],
											enabled,
										)
									}
								/>
							</SearchableSetting>
						)
					})}
			</Section>
		</div>
	)
}
