import React, { useCallback, useMemo, useState } from "react"
import { useEvent } from "react-use"
import {
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import {
	CLOUDFLARE_IMAGE_PROVIDER_PRESET,
	IMAGE_GENERATION_CUSTOM_DEFAULT_API_METHOD,
	IMAGE_GENERATION_CUSTOM_PROVIDER_PRESETS,
	IMAGE_GENERATION_DEFAULT_API_METHOD,
	IMAGE_GENERATION_DEFAULT_MODEL,
	IMAGE_GENERATION_DEFAULT_PROVIDER,
	IMAGE_GENERATION_OPENROUTER_DEFAULT_BASE_URL,
	IMAGE_GENERATION_OPENROUTER_PRESET_MODELS,
	IMAGE_GENERATION_GOOGLE_EXPRESS_DEFAULT_MODEL,
	IMAGE_GENERATION_GOOGLE_EXPRESS_PRESET_MODELS,
	IMAGE_GENERATION_PROVIDER_MODEL_PRESETS,
	IMAGE_GENERATION_VERTEX_DEFAULT_AUTH_MODE,
	IMAGE_GENERATION_VERTEX_DEFAULT_MODEL,
	IMAGE_GENERATION_VERTEX_DEFAULT_REGION,
	IMAGE_GENERATION_VERTEX_PRESET_MODELS,
	IMAGE_GENERATION_VERTEX_REGIONS,
	OPENAI_CHAT_IMAGE_PROVIDER_PRESET,
	OPENAI_IMAGES_PROVIDER_PRESET,
	POYO_IMAGE_PROVIDER_PRESET,
	type CustomImageProviderConfig,
	type CustomImageProviderPresetId,
	type ExtensionMessage,
	type ImageGenerationApiMethod,
	type ImageGenerationProvider,
	type VertexImageAuthMode,
} from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { convertHeadersToObject } from "./utils/headers"

interface ImageGenerationSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
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
	setImageGenerationProvider: (provider: ImageGenerationProvider) => void
	setImageGenerationBaseUrl: (baseUrl: string) => void
	setImageGenerationApiKey: (apiKey: string) => void
	setImageGenerationHeaders: (headers: Record<string, string>) => void
	setImageGenerationSelectedModel: (model: string) => void
	setImageGenerationApiMethod: (apiMethod: ImageGenerationApiMethod) => void
	setImageGenerationCustomProvider: (customProvider: CustomImageProviderConfig) => void
	setVertexImageProjectId: (projectId: string) => void
	setVertexImageRegion: (region: string) => void
	setVertexImageModel: (model: string) => void
	setVertexImageAuthMode: (authMode: VertexImageAuthMode) => void
	setVertexImageAccessToken: (accessToken: string) => void
	setVertexImageServiceAccountJson: (serviceAccountJson: string) => void
}

export const ImageGenerationSettings = ({
	enabled,
	onChange,
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
}: ImageGenerationSettingsProps) => {
	const { t } = useAppTranslation()
	const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
	const [modelRefreshLoading, setModelRefreshLoading] = useState(false)
	const [modelRefreshError, setModelRefreshError] = useState<string | null>(null)
	const [testProviderLoading, setTestProviderLoading] = useState(false)
	const [testProviderResult, setTestProviderResult] = useState<{
		success: boolean
		message: string
		imageData?: string
	} | null>(null)
	const [customHeaders, setCustomHeaders] = useState<[string, string][]>(() =>
		Object.entries(imageGenerationHeaders || {}),
	)

	const currentProvider = imageGenerationProvider || IMAGE_GENERATION_DEFAULT_PROVIDER
	// NOTE: Use raw imageGenerationBaseUrl without fallback so requestModels sends the actual
	// user-entered value (including empty string). Only use the default when rendering in the UI.
	const currentBaseUrl = imageGenerationBaseUrl || IMAGE_GENERATION_OPENROUTER_DEFAULT_BASE_URL
	const currentModel =
		imageGenerationSelectedModel ||
		(currentProvider === "google-express"
			? IMAGE_GENERATION_GOOGLE_EXPRESS_DEFAULT_MODEL
			: IMAGE_GENERATION_DEFAULT_MODEL)
	const currentApiMethod = imageGenerationApiMethod || IMAGE_GENERATION_DEFAULT_API_METHOD
	const currentVertexRegion = vertexImageRegion || IMAGE_GENERATION_VERTEX_DEFAULT_REGION
	const currentVertexModel = vertexImageModel || IMAGE_GENERATION_VERTEX_DEFAULT_MODEL
	const currentVertexAuthMode = vertexImageAuthMode || IMAGE_GENERATION_VERTEX_DEFAULT_AUTH_MODE
	const currentCustomProvider = imageGenerationCustomProvider || {}
	const isVertexProvider = currentProvider === "vertex-ai"
	const isGoogleExpressProvider = currentProvider === "google-express"
	const isCustomProvider = currentProvider === "custom"
	const isVertexApiKeyMode = isVertexProvider && currentVertexAuthMode === "api_key"

	const availableModels = useMemo(() => {
		const ids = new Map<string, string>()
		// Add provider-specific preset models
		if (isVertexProvider) {
			for (const model of IMAGE_GENERATION_VERTEX_PRESET_MODELS) {
				ids.set(model.value, model.label)
			}
		} else if (isGoogleExpressProvider) {
			for (const model of IMAGE_GENERATION_GOOGLE_EXPRESS_PRESET_MODELS) {
				ids.set(model.value, model.label)
			}
		} else {
			for (const model of IMAGE_GENERATION_OPENROUTER_PRESET_MODELS) {
				ids.set(model.value, model.label)
			}
		}
		for (const model of discoveredModels) {
			ids.set(model, model)
		}
		if (currentModel) {
			ids.set(currentModel, ids.get(currentModel) || currentModel)
		}
		return [...ids.entries()].map(([value, label]) => ({ value, label }))
	}, [currentModel, discoveredModels, isVertexProvider, isGoogleExpressProvider])

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type === "imageGenerationModels") {
			setDiscoveredModels(message.imageGenerationModels ?? [])
			setModelRefreshLoading(false)
			setModelRefreshError(message.error ?? null)
		}
		if (message.type === "imageGenerationTestResult") {
			setTestProviderLoading(false)
			setTestProviderResult({
				success: message.success ?? false,
				message: message.error || message.text || "",
				imageData: message.images?.[0],
			})
		}
	}, [])

	useEvent("message", onMessage)

	const handleProviderChange = (value: string) => {
		const nextProvider = (value || IMAGE_GENERATION_DEFAULT_PROVIDER) as ImageGenerationProvider
		setImageGenerationProvider(nextProvider)
		// Clear stale model list from previous provider
		setDiscoveredModels([])
		setModelRefreshError(null)
		if (nextProvider === "google-express" && !imageGenerationSelectedModel) {
			setImageGenerationSelectedModel(IMAGE_GENERATION_GOOGLE_EXPRESS_DEFAULT_MODEL)
		}
	}

	const setCustomProviderField = <K extends keyof CustomImageProviderConfig>(
		field: K,
		value: CustomImageProviderConfig[K],
	) => {
		setImageGenerationCustomProvider({ ...currentCustomProvider, [field]: value })
	}

	const applyCustomPreset = (presetId: CustomImageProviderPresetId) => {
		setImageGenerationProvider("custom")
		setDiscoveredModels([])
		setModelRefreshError(null)

		if (presetId === "cloudflare-workers-ai") {
			setImageGenerationBaseUrl("https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/run")
			setImageGenerationApiMethod("direct_post")
			setImageGenerationSelectedModel("@cf/stabilityai/stable-diffusion-xl-base-1.0")
			setImageGenerationCustomProvider(CLOUDFLARE_IMAGE_PROVIDER_PRESET)
			return
		}

		if (presetId === "poyo-ai") {
			setImageGenerationBaseUrl("https://api.poyo.ai")
			setImageGenerationApiMethod("async_submit_poll")
			setImageGenerationSelectedModel("gpt-image-1.5")
			setImageGenerationCustomProvider(POYO_IMAGE_PROVIDER_PRESET)
			return
		}

		if (presetId === "openai-images") {
			setImageGenerationBaseUrl("https://api.openai.com/v1")
			setImageGenerationApiMethod("images_api")
			setImageGenerationSelectedModel("gpt-image-1")
			setImageGenerationCustomProvider(OPENAI_IMAGES_PROVIDER_PRESET)
			return
		}

		if (presetId === "openai-chat") {
			setImageGenerationBaseUrl(IMAGE_GENERATION_OPENROUTER_DEFAULT_BASE_URL)
			setImageGenerationApiMethod("chat_completions")
			setImageGenerationSelectedModel(IMAGE_GENERATION_DEFAULT_MODEL)
			setImageGenerationCustomProvider(OPENAI_CHAT_IMAGE_PROVIDER_PRESET)
			return
		}

		setImageGenerationApiMethod(IMAGE_GENERATION_CUSTOM_DEFAULT_API_METHOD)
		setImageGenerationCustomProvider({ name: "Manual Provider", presetId: "manual" })
	}

	const handleUsePoyoPreset = () => applyCustomPreset("poyo-ai")

	const handleUseOpenRouterPreset = () => {
		setImageGenerationProvider(IMAGE_GENERATION_DEFAULT_PROVIDER)
		setImageGenerationBaseUrl(IMAGE_GENERATION_OPENROUTER_DEFAULT_BASE_URL)
		if (!currentModel) {
			setImageGenerationSelectedModel(IMAGE_GENERATION_DEFAULT_MODEL)
		}
		if (!imageGenerationApiMethod) {
			setImageGenerationApiMethod(IMAGE_GENERATION_DEFAULT_API_METHOD)
		}
	}

	const requestModels = () => {
		setModelRefreshLoading(true)
		setModelRefreshError(null)
		// Send the RAW user-entered baseUrl (no fallback) so the backend can
		// detect empty/invalid URLs and return an error instead of silently
		// falling back to OpenRouter's default models endpoint.
		vscode.postMessage({
			type: "requestImageGenerationModels",
			values: {
				provider: currentProvider,
				baseUrl: imageGenerationBaseUrl || "", // raw value, no fallback
				apiKey: imageGenerationApiKey,
				headers: imageGenerationHeaders || {},
				apiMethod: currentApiMethod,
			},
		})
	}

	const setHeaderRows = (rows: [string, string][]) => {
		setCustomHeaders(rows)
		setImageGenerationHeaders(convertHeadersToObject(rows))
	}

	const isConfigured = isVertexProvider
		? !!currentVertexModel &&
			(currentVertexAuthMode === "api_key"
				? !!vertexImageAccessToken
				: !!vertexImageProjectId &&
					!!currentVertexRegion &&
					(currentVertexAuthMode === "service_account_json"
						? !!vertexImageServiceAccountJson
						: !!vertexImageAccessToken))
		: isGoogleExpressProvider
			? !!imageGenerationApiKey && !!currentModel
			: isCustomProvider
				? !!imageGenerationApiKey &&
					!!currentBaseUrl &&
					!!currentModel &&
					(currentApiMethod === "async_submit_poll"
						? !!currentCustomProvider.submitPath
						: currentApiMethod === "direct_post"
							? !!currentCustomProvider.directPath
							: true)
				: !!imageGenerationApiKey && !!currentBaseUrl && !!currentModel

	return (
		<div className="space-y-4">
			<div>
				<div className="flex items-center gap-2">
					<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
						<span className="font-medium">{t("settings:experimental.IMAGE_GENERATION.name")}</span>
					</VSCodeCheckbox>
				</div>
				<p className="text-vscode-descriptionForeground text-sm mt-0">
					{t("settings:experimental.IMAGE_GENERATION.description")}
				</p>
			</div>

			{enabled && (
				<div className="ml-2 space-y-3">
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.providerLabel")}
						</label>
						<VSCodeDropdown
							value={currentProvider}
							onChange={(e: any) => handleProviderChange(e.target.value)}
							className="w-full">
							<VSCodeOption value="openai-compatible" className="py-2 px-3">
								{t("settings:experimental.IMAGE_GENERATION.openAiCompatibleProvider")}
							</VSCodeOption>
							<VSCodeOption value="vertex-ai" className="py-2 px-3">
								Vertex AI
							</VSCodeOption>
							<VSCodeOption value="google-express" className="py-2 px-3">
								Google Express Mode (API key)
							</VSCodeOption>
							<VSCodeOption value="custom" className="py-2 px-3">
								Custom Provider (easy presets)
							</VSCodeOption>
						</VSCodeDropdown>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.providerDescription")}
						</p>
					</div>

					{isVertexProvider ? (
						<>
							{!isVertexApiKeyMode && (
								<>
									<div>
										<label className="block font-medium mb-1">Vertex Project ID</label>
										<VSCodeTextField
											value={vertexImageProjectId || ""}
											onInput={(e: any) => setVertexImageProjectId(e.target.value)}
											placeholder="my-gcp-project"
											className="w-full"
										/>
									</div>

									<div>
										<label className="block font-medium mb-1">Vertex Region</label>
										<VSCodeDropdown
											value={currentVertexRegion}
											onChange={(e: any) => setVertexImageRegion(e.target.value)}
											className="w-full">
											{IMAGE_GENERATION_VERTEX_REGIONS.map((region) => (
												<VSCodeOption
													key={region.value}
													value={region.value}
													className="py-2 px-3">
													{region.label}
												</VSCodeOption>
											))}
										</VSCodeDropdown>
									</div>
								</>
							)}

							<div>
								<label className="block font-medium mb-1">Vertex Imagen Model</label>
								<VSCodeDropdown
									value={currentVertexModel}
									onChange={(e: any) => setVertexImageModel(e.target.value)}
									className="w-full">
									{IMAGE_GENERATION_VERTEX_PRESET_MODELS.map((model) => (
										<VSCodeOption key={model.value} value={model.value} className="py-2 px-3">
											{model.label}
										</VSCodeOption>
									))}
								</VSCodeDropdown>
								<VSCodeTextField
									value={currentVertexModel}
									onInput={(e: any) => setVertexImageModel(e.target.value)}
									placeholder={IMAGE_GENERATION_VERTEX_DEFAULT_MODEL}
									className="w-full mt-2"
								/>
							</div>

							<div>
								<label className="block font-medium mb-1">Vertex Authentication</label>
								<VSCodeDropdown
									value={currentVertexAuthMode}
									onChange={(e: any) => setVertexImageAuthMode(e.target.value)}
									className="w-full">
									<VSCodeOption value="api_key" className="py-2 px-3">
										API Key (Express Mode)
									</VSCodeOption>
									<VSCodeOption value="access_token" className="py-2 px-3">
										Access Token
									</VSCodeOption>
									<VSCodeOption value="service_account_json" className="py-2 px-3">
										Service Account JSON
									</VSCodeOption>
								</VSCodeDropdown>
							</div>

							<div>
								<label className="block font-medium mb-1">
									{currentVertexAuthMode === "service_account_json"
										? "Service Account JSON"
										: currentVertexAuthMode === "api_key"
											? "API Key"
											: "Access Token"}
								</label>
								<VSCodeTextField
									value={
										currentVertexAuthMode === "service_account_json"
											? vertexImageServiceAccountJson || ""
											: vertexImageAccessToken || ""
									}
									onInput={(e: any) =>
										currentVertexAuthMode === "service_account_json"
											? setVertexImageServiceAccountJson(e.target.value)
											: setVertexImageAccessToken(e.target.value)
									}
									placeholder={
										currentVertexAuthMode === "service_account_json"
											? "Paste service account JSON"
											: currentVertexAuthMode === "api_key"
												? "Paste Vertex AI Express Mode API key"
												: "Paste OAuth access token"
									}
									className="w-full"
									type="password"
								/>
								<p className="text-vscode-descriptionForeground text-xs mt-1">
									{currentVertexAuthMode === "api_key"
										? "Use a Google Cloud API key with Vertex AI Express Mode. No OAuth or service account needed."
										: "Stored in VS Code Secret Storage for this installation only."}
								</p>
							</div>

							<div className="mt-4">
								<div className="flex items-center justify-between gap-2 mb-2">
									<label className="block font-medium">Test Provider</label>
									<VSCodeButton
										appearance="secondary"
										onClick={() => {
											setTestProviderLoading(true)
											setTestProviderResult(null)
											vscode.postMessage({
												type: "testImageGenerationProvider",
												values: {
													provider: currentProvider,
													apiKey:
														currentVertexAuthMode === "api_key"
															? vertexImageAccessToken
															: "",
													model: currentVertexModel,
													vertexProjectId: vertexImageProjectId,
													vertexRegion: currentVertexRegion,
													vertexModel: currentVertexModel,
													vertexAuthMode: currentVertexAuthMode,
													vertexAccessToken: vertexImageAccessToken,
													vertexServiceAccountJson: vertexImageServiceAccountJson,
												},
											})
										}}
										disabled={!isConfigured || testProviderLoading}>
										{testProviderLoading ? "Testing..." : "Test Provider"}
									</VSCodeButton>
								</div>
								{testProviderResult && (
									<div
										className={`p-2 rounded text-xs ${testProviderResult.success ? "bg-vscode-editorInfo-background text-vscode-editorInfo-foreground" : "bg-vscode-editorWarning-background text-vscode-editorWarning-foreground"}`}>
										{testProviderResult.success ? "✓ " : " "}
										{testProviderResult.message}
										{testProviderResult.imageData && (
											<div className="mt-2">
												<img
													src={testProviderResult.imageData}
													alt="Test result"
													className="max-w-full rounded border border-vscode-panel-border"
												/>
											</div>
										)}
									</div>
								)}
							</div>
						</>
					) : isGoogleExpressProvider ? (
						<>
							<div>
								<label className="block font-medium mb-1">Google Express API Key</label>
								<VSCodeTextField
									value={imageGenerationApiKey || ""}
									onInput={(e: any) => setImageGenerationApiKey(e.target.value)}
									placeholder="Paste API key from Agent Platform Express Mode"
									className="w-full"
									type="password"
								/>
								<p className="text-vscode-descriptionForeground text-xs mt-1">
									Use this for Google Cloud Agent Platform Express Mode projects where IAM/service
									accounts are not available.
								</p>
							</div>

							<div>
								<label className="block font-medium mb-1">Google Imagen Model</label>
								<VSCodeDropdown
									value={currentModel}
									onChange={(e: any) => setImageGenerationSelectedModel(e.target.value)}
									className="w-full">
									{IMAGE_GENERATION_GOOGLE_EXPRESS_PRESET_MODELS.map((model) => (
										<VSCodeOption key={model.value} value={model.value} className="py-2 px-3">
											{model.label}
										</VSCodeOption>
									))}
								</VSCodeDropdown>
								<VSCodeTextField
									value={currentModel}
									onInput={(e: any) => setImageGenerationSelectedModel(e.target.value)}
									placeholder={IMAGE_GENERATION_GOOGLE_EXPRESS_DEFAULT_MODEL}
									className="w-full mt-2"
								/>
								<p className="text-vscode-descriptionForeground text-xs mt-1">
									Calls Vertex AI with an API key (Express Mode). Uses the same endpoint as the
									chat/completion provider.
								</p>
							</div>

							<div className="mt-4">
								<div className="flex items-center justify-between gap-2 mb-2">
									<label className="block font-medium">Test Provider</label>
									<VSCodeButton
										appearance="secondary"
										onClick={() => {
											setTestProviderLoading(true)
											setTestProviderResult(null)
											vscode.postMessage({
												type: "testImageGenerationProvider",
												values: {
													provider: currentProvider,
													apiKey: imageGenerationApiKey,
													model: currentModel,
												},
											})
										}}
										disabled={!isConfigured || testProviderLoading}>
										{testProviderLoading ? "Testing..." : "Test Provider"}
									</VSCodeButton>
								</div>
								{testProviderResult && (
									<div
										className={`p-2 rounded text-xs ${testProviderResult.success ? "bg-vscode-editorInfo-background text-vscode-editorInfo-foreground" : "bg-vscode-editorWarning-background text-vscode-editorWarning-foreground"}`}>
										{testProviderResult.success ? "✓ " : " "}
										{testProviderResult.message}
										{testProviderResult.imageData && (
											<div className="mt-2">
												<img
													src={testProviderResult.imageData}
													alt="Test result"
													className="max-w-full rounded border border-vscode-panel-border"
												/>
											</div>
										)}
									</div>
								)}
							</div>
						</>
					) : (
						<>
							{isCustomProvider && (
								<div className="p-3 border border-vscode-panel-border rounded space-y-2">
									<label className="block font-medium mb-1">Provider Template</label>
									<VSCodeDropdown
										value={currentCustomProvider.presetId || "manual"}
										onChange={(e: any) => applyCustomPreset(e.target.value)}
										className="w-full">
										{IMAGE_GENERATION_CUSTOM_PROVIDER_PRESETS.map((preset) => (
											<VSCodeOption key={preset.id} value={preset.id} className="py-2 px-3">
												{preset.label}
											</VSCodeOption>
										))}
									</VSCodeDropdown>
									<p className="text-vscode-descriptionForeground text-xs mt-1">
										Choose a template first. Most fields will be auto-filled; then only replace
										placeholders like YOUR_ACCOUNT_ID.
									</p>
								</div>
							)}

							<div>
								<div className="flex items-center justify-between gap-2 mb-1">
									<label className="block font-medium">
										{t("settings:experimental.IMAGE_GENERATION.baseUrlLabel")}
									</label>
									<VSCodeButton appearance="secondary" onClick={handleUseOpenRouterPreset}>
										{t("settings:experimental.IMAGE_GENERATION.openRouterPreset")}
									</VSCodeButton>
								</div>
								<VSCodeTextField
									value={currentBaseUrl}
									onInput={(e: any) => setImageGenerationBaseUrl(e.target.value)}
									placeholder={IMAGE_GENERATION_OPENROUTER_DEFAULT_BASE_URL}
									className="w-full"
									type="url"
								/>
							</div>

							<div>
								<label className="block font-medium mb-1">
									{t("settings:experimental.IMAGE_GENERATION.apiKeyLabel")}
								</label>
								<VSCodeTextField
									value={imageGenerationApiKey || ""}
									onInput={(e: any) => setImageGenerationApiKey(e.target.value)}
									placeholder={t("settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder")}
									className="w-full"
									type="password"
								/>
							</div>

							<div>
								<label className="block font-medium mb-1">
									{t("settings:experimental.IMAGE_GENERATION.apiMethodLabel")}
								</label>
								<VSCodeDropdown
									value={currentApiMethod}
									onChange={(e: any) => setImageGenerationApiMethod(e.target.value)}
									className="w-full">
									<VSCodeOption value="chat_completions" className="py-2 px-3">
										{t("settings:experimental.IMAGE_GENERATION.chatCompletionsMethod")}
									</VSCodeOption>
									<VSCodeOption value="images_api" className="py-2 px-3">
										{t("settings:experimental.IMAGE_GENERATION.imagesApiMethod")}
									</VSCodeOption>
									{isCustomProvider && (
										<VSCodeOption value="direct_post" className="py-2 px-3">
											Direct POST
										</VSCodeOption>
									)}
									{isCustomProvider && (
										<VSCodeOption value="async_submit_poll" className="py-2 px-3">
											Async Submit / Poll
										</VSCodeOption>
									)}
								</VSCodeDropdown>
							</div>

							{isCustomProvider && currentApiMethod === "direct_post" && (
								<div className="space-y-3 p-3 border border-vscode-panel-border rounded">
									<label className="block font-medium">Direct POST Mapping</label>
									<VSCodeTextField
										value={currentCustomProvider.name || ""}
										onInput={(e: any) => setCustomProviderField("name", e.target.value)}
										placeholder="Provider name (e.g. Cloudflare Workers AI)"
										className="w-full"
									/>
									<VSCodeTextField
										value={currentCustomProvider.directPath || ""}
										onInput={(e: any) => setCustomProviderField("directPath", e.target.value)}
										placeholder="Direct path: /{{model}}"
										className="w-full"
									/>
									<textarea
										value={currentCustomProvider.directBodyTemplate || ""}
										onChange={(e) => setCustomProviderField("directBodyTemplate", e.target.value)}
										placeholder={"JSON body template. Use {{prompt}}"}
										className="w-full min-h-[80px] bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded p-2 font-mono text-xs"
									/>
									<VSCodeTextField
										value={currentCustomProvider.directImagePath || ""}
										onInput={(e: any) => setCustomProviderField("directImagePath", e.target.value)}
										placeholder="Image path for JSON responses; leave empty for binary image response"
										className="w-full"
									/>
									<p className="text-vscode-descriptionForeground text-xs mt-1">
										Cloudflare: set Base URL to
										https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/run and model
										to @cf/...
									</p>
								</div>
							)}

							{isCustomProvider && currentApiMethod === "async_submit_poll" && (
								<div className="space-y-3 p-3 border border-vscode-panel-border rounded">
									<div className="flex items-center justify-between gap-2">
										<label className="block font-medium">Custom Submit/Poll Mapping</label>
										<VSCodeButton appearance="secondary" onClick={handleUsePoyoPreset}>
											Use Poyo preset
										</VSCodeButton>
									</div>
									<VSCodeTextField
										value={currentCustomProvider.name || ""}
										onInput={(e: any) => setCustomProviderField("name", e.target.value)}
										placeholder="Provider name (e.g. Poyo AI)"
										className="w-full"
									/>
									<VSCodeTextField
										value={currentCustomProvider.submitPath || ""}
										onInput={(e: any) => setCustomProviderField("submitPath", e.target.value)}
										placeholder="Submit path: /api/generate/submit"
										className="w-full"
									/>
									<VSCodeDropdown
										value={currentCustomProvider.submitMethod || "POST"}
										onChange={(e: any) => setCustomProviderField("submitMethod", e.target.value)}
										className="w-full">
										<VSCodeOption value="POST">POST</VSCodeOption>
										<VSCodeOption value="PUT">PUT</VSCodeOption>
										<VSCodeOption value="PATCH">PATCH</VSCodeOption>
									</VSCodeDropdown>
									<textarea
										value={currentCustomProvider.submitBodyTemplate || ""}
										onChange={(e) => setCustomProviderField("submitBodyTemplate", e.target.value)}
										placeholder={"JSON body template. Use {{model}}, {{prompt}}, {{inputImage}}"}
										className="w-full min-h-[120px] bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded p-2 font-mono text-xs"
									/>
									<VSCodeTextField
										value={currentCustomProvider.taskIdPath || ""}
										onInput={(e: any) => setCustomProviderField("taskIdPath", e.target.value)}
										placeholder="Task ID path: data.task_id"
										className="w-full"
									/>
									<VSCodeTextField
										value={currentCustomProvider.pollPath || ""}
										onInput={(e: any) => setCustomProviderField("pollPath", e.target.value)}
										placeholder="Poll path: /api/generate/status/{{taskId}}"
										className="w-full"
									/>
									<VSCodeDropdown
										value={currentCustomProvider.pollMethod || "GET"}
										onChange={(e: any) => setCustomProviderField("pollMethod", e.target.value)}
										className="w-full">
										<VSCodeOption value="GET">GET</VSCodeOption>
										<VSCodeOption value="POST">POST</VSCodeOption>
									</VSCodeDropdown>
									<div className="grid grid-cols-2 gap-2">
										<VSCodeTextField
											value={currentCustomProvider.statusPath || ""}
											onInput={(e: any) => setCustomProviderField("statusPath", e.target.value)}
											placeholder="Status path: data.status"
										/>
										<VSCodeTextField
											value={currentCustomProvider.imageUrlPath || ""}
											onInput={(e: any) => setCustomProviderField("imageUrlPath", e.target.value)}
											placeholder="Image URL path: data.files.0.file_url"
										/>
										<VSCodeTextField
											value={currentCustomProvider.successStatus || "finished"}
											onInput={(e: any) =>
												setCustomProviderField("successStatus", e.target.value)
											}
											placeholder="Success status"
										/>
										<VSCodeTextField
											value={currentCustomProvider.failureStatus || "failed"}
											onInput={(e: any) =>
												setCustomProviderField("failureStatus", e.target.value)
											}
											placeholder="Failure status"
										/>
										<VSCodeTextField
											value={String(currentCustomProvider.pollIntervalMs ?? 5000)}
											onInput={(e: any) =>
												setCustomProviderField("pollIntervalMs", Number(e.target.value))
											}
											placeholder="Poll interval ms"
										/>
										<VSCodeTextField
											value={String(currentCustomProvider.pollMaxAttempts ?? 60)}
											onInput={(e: any) =>
												setCustomProviderField("pollMaxAttempts", Number(e.target.value))
											}
											placeholder="Max poll attempts"
										/>
									</div>
									<p className="text-vscode-descriptionForeground text-xs mt-1">
										Dot paths support array indexes, e.g. data.files.0.file_url. Templates support{" "}
										{"{{model}}"}, {"{{prompt}}"}, {"{{taskId}}"}, and {"{{inputImage}}"}.
									</p>
								</div>
							)}

							<div>
								<div className="flex items-center justify-between gap-2 mb-1">
									<label className="block font-medium">
										{t("settings:experimental.IMAGE_GENERATION.modelSelectionLabel")}
									</label>
									<VSCodeButton
										appearance="secondary"
										onClick={requestModels}
										disabled={
											(!imageGenerationBaseUrl &&
												!isVertexProvider &&
												!isGoogleExpressProvider) ||
											modelRefreshLoading
										}>
										{modelRefreshLoading
											? t("settings:experimental.IMAGE_GENERATION.loadingModels")
											: t("settings:experimental.IMAGE_GENERATION.refreshModels")}
									</VSCodeButton>
								</div>
								{modelRefreshError && (
									<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-xs mb-2">
										{modelRefreshError}
									</div>
								)}
								{isCustomProvider &&
									currentCustomProvider.presetId &&
									IMAGE_GENERATION_PROVIDER_MODEL_PRESETS[currentCustomProvider.presetId] && (
										<>
											<VSCodeDropdown
												value={currentModel}
												onChange={(e: any) => setImageGenerationSelectedModel(e.target.value)}
												className="w-full mb-2">
												{IMAGE_GENERATION_PROVIDER_MODEL_PRESETS[
													currentCustomProvider.presetId
												].map((model) => (
													<VSCodeOption
														key={model.value}
														value={model.value}
														className="py-2 px-3">
														{model.label}
													</VSCodeOption>
												))}
											</VSCodeDropdown>
											<p className="text-vscode-descriptionForeground text-xs mb-2">
												Select a preset model or type a custom model ID below.
											</p>
										</>
									)}
								<VSCodeDropdown
									value={currentModel}
									onChange={(e: any) => setImageGenerationSelectedModel(e.target.value)}
									className="w-full">
									{availableModels.map((model) => (
										<VSCodeOption key={model.value} value={model.value} className="py-2 px-3">
											{model.label}
										</VSCodeOption>
									))}
								</VSCodeDropdown>
								<VSCodeTextField
									value={currentModel}
									onInput={(e: any) => setImageGenerationSelectedModel(e.target.value)}
									placeholder={t("settings:experimental.IMAGE_GENERATION.manualModelPlaceholder")}
									className="w-full mt-2"
								/>
								<p className="text-vscode-descriptionForeground text-xs mt-1">
									{t("settings:experimental.IMAGE_GENERATION.modelSelectionDescription")}
								</p>
							</div>

							<div>
								<div className="flex items-center justify-between gap-2 mb-1">
									<label className="block font-medium">
										{t("settings:experimental.IMAGE_GENERATION.customHeadersLabel")}
									</label>
									<VSCodeButton
										appearance="icon"
										onClick={() => setHeaderRows([...customHeaders, ["", ""]])}>
										<span className="codicon codicon-add" />
									</VSCodeButton>
								</div>
								{customHeaders.length === 0 ? (
									<div className="text-sm text-vscode-descriptionForeground">
										{t("settings:experimental.IMAGE_GENERATION.noCustomHeaders")}
									</div>
								) : (
									customHeaders.map(([key, value], index) => (
										<div key={index} className="flex items-center gap-2 mb-2">
											<VSCodeTextField
												value={key}
												placeholder={t("settings:experimental.IMAGE_GENERATION.headerName")}
												className="flex-1"
												onInput={(e: any) => {
													const updated = [...customHeaders]
													updated[index] = [e.target.value, value]
													setHeaderRows(updated)
												}}
											/>
											<VSCodeTextField
												value={value}
												placeholder={t("settings:experimental.IMAGE_GENERATION.headerValue")}
												className="flex-1"
												onInput={(e: any) => {
													const updated = [...customHeaders]
													updated[index] = [key, e.target.value]
													setHeaderRows(updated)
												}}
											/>
											<VSCodeButton
												appearance="icon"
												onClick={() =>
													setHeaderRows(customHeaders.filter((_, i) => i !== index))
												}>
												<span className="codicon codicon-trash" />
											</VSCodeButton>
										</div>
									))
								)}
							</div>

							<div className="mt-4">
								<div className="flex items-center justify-between gap-2 mb-2">
									<label className="block font-medium">Test Provider</label>
									<VSCodeButton
										appearance="secondary"
										onClick={() => {
											setTestProviderLoading(true)
											setTestProviderResult(null)
											vscode.postMessage({
												type: "testImageGenerationProvider",
												values: {
													provider: currentProvider,
													baseUrl: currentBaseUrl,
													apiKey: imageGenerationApiKey,
													headers: convertHeadersToObject(customHeaders),
													model: currentModel,
													apiMethod: currentApiMethod,
													customProvider: currentCustomProvider,
												},
											})
										}}
										disabled={!isConfigured || testProviderLoading}>
										{testProviderLoading ? "Testing..." : "Test Provider"}
									</VSCodeButton>
								</div>
								{testProviderResult && (
									<div
										className={`p-2 rounded text-xs ${testProviderResult.success ? "bg-vscode-editorInfo-background text-vscode-editorInfo-foreground" : "bg-vscode-editorWarning-background text-vscode-editorWarning-foreground"}`}>
										{testProviderResult.success ? "✓ " : " "}
										{testProviderResult.message}
										{testProviderResult.imageData && (
											<div className="mt-2">
												<img
													src={testProviderResult.imageData}
													alt="Test result"
													className="max-w-full rounded border border-vscode-panel-border"
												/>
											</div>
										)}
									</div>
								)}
							</div>
						</>
					)}

					{enabled && !isConfigured && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.warningMissingConfiguration")}
						</div>
					)}

					{enabled && isConfigured && (
						<div className="p-2 bg-vscode-editorInfo-background text-vscode-editorInfo-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.successConfigured")}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
