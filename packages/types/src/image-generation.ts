/**
 * API method used for image generation.
 */
export type ImageGenerationApiMethod = "chat_completions" | "images_api" | "async_submit_poll" | "direct_post"

export interface ImageGenerationModelPreset {
	value: string
	label: string
}

export type VertexImageAuthMode = "access_token" | "service_account_json" | "api_key"

/**
 * Image generation providers.
 *
 * OpenRouter is represented as the default preset for the OpenAI-compatible
 * provider rather than as a distinct implementation branch.
 */
export type ImageGenerationProvider = "openai-compatible" | "vertex-ai" | "google-express" | "custom"

export type LegacyImageGenerationProvider = "openrouter"

export const IMAGE_GENERATION_OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
export const IMAGE_GENERATION_DEFAULT_PROVIDER: ImageGenerationProvider = "openai-compatible"
export const IMAGE_GENERATION_DEFAULT_MODEL = "google/gemini-2.5-flash-image"
export const IMAGE_GENERATION_DEFAULT_API_METHOD: ImageGenerationApiMethod = "chat_completions"
export const IMAGE_GENERATION_CUSTOM_DEFAULT_API_METHOD: ImageGenerationApiMethod = "direct_post"

export const IMAGE_GENERATION_VERTEX_DEFAULT_REGION = "us-central1"
export const IMAGE_GENERATION_VERTEX_DEFAULT_MODEL = "imagen-4.0-ultra-generate-001"
export const IMAGE_GENERATION_VERTEX_DEFAULT_AUTH_MODE: VertexImageAuthMode = "api_key"
export const IMAGE_GENERATION_GOOGLE_EXPRESS_DEFAULT_MODEL = "gemini-2.5-flash-image"

export const IMAGE_GENERATION_VERTEX_REGIONS = [
	{ value: "us-central1", label: "US Central 1 (Iowa)" },
	{ value: "us-east1", label: "US East 1 (South Carolina)" },
	{ value: "us-east4", label: "US East 4 (Northern Virginia)" },
	{ value: "us-west1", label: "US West 1 (Oregon)" },
	{ value: "europe-west1", label: "Europe West 1 (Belgium)" },
	{ value: "europe-west4", label: "Europe West 4 (Netherlands)" },
	{ value: "asia-northeast1", label: "Asia Northeast 1 (Tokyo)" },
	{ value: "asia-southeast1", label: "Asia Southeast 1 (Singapore)" },
] as const

export interface ImageGenerationPresetModel {
	value: string
	label: string
	apiMethod?: ImageGenerationApiMethod
}

export type CustomImageProviderPresetId =
	| "openai-images"
	| "openai-chat"
	| "cloudflare-workers-ai"
	| "poyo-ai"
	| "manual"

export interface CustomImageProviderConfig {
	/** Optional display name for the custom provider profile. */
	name?: string
	/** Preset used to auto-fill this profile. */
	presetId?: CustomImageProviderPresetId
	/** Direct POST path template. Supports {{model}}. Example: /client/v4/accounts/abc/ai/run/{{model}} */
	directPath?: string
	/** JSON request body template for direct POST providers. Supports {{model}}, {{prompt}}, and {{inputImage}}. */
	directBodyTemplate?: string
	/** Dot-path used to extract an image URL/base64/data URL from JSON direct responses. Empty means binary response body. */
	directImagePath?: string
	/** Optional dot-path used to extract provider error text from JSON direct responses. */
	directErrorPath?: string
	/** Submit endpoint path, appended to imageGenerationBaseUrl. Example: /api/generate/submit */
	submitPath?: string
	/** HTTP method for submit endpoint. Defaults to POST. */
	submitMethod?: "POST" | "PUT" | "PATCH"
	/** JSON request body template. Supports {{model}}, {{prompt}}, and {{inputImage}} placeholders. */
	submitBodyTemplate?: string
	/** Dot-path used to extract the task ID from submit response. Example: data.task_id */
	taskIdPath?: string
	/** Poll endpoint path template. Supports {{taskId}}. Example: /api/generate/status/{{taskId}} */
	pollPath?: string
	/** HTTP method for poll endpoint. Defaults to GET. */
	pollMethod?: "GET" | "POST"
	/** Dot-path used to read status from poll response. Example: data.status */
	statusPath?: string
	/** Status value that means generation succeeded. Defaults to finished. */
	successStatus?: string
	/** Status value that means generation failed. Defaults to failed. */
	failureStatus?: string
	/** Dot-path used to extract final image URL/base64/data URL from poll response. Example: data.files.0.file_url */
	imageUrlPath?: string
	/** Optional dot-path used to extract provider error text. */
	errorPath?: string
	/** Poll delay in milliseconds. Defaults to 5000. */
	pollIntervalMs?: number
	/** Max poll attempts. Defaults to 60. */
	pollMaxAttempts?: number
	/** Output image format used when downloading URL responses. Defaults to png if content-type is unavailable. */
	outputFormat?: "png" | "jpeg" | "jpg" | "webp"
}

export const POYO_IMAGE_PROVIDER_PRESET: Required<
	Pick<
		CustomImageProviderConfig,
		| "name"
		| "submitPath"
		| "submitMethod"
		| "submitBodyTemplate"
		| "taskIdPath"
		| "pollPath"
		| "pollMethod"
		| "statusPath"
		| "successStatus"
		| "failureStatus"
		| "imageUrlPath"
		| "errorPath"
		| "pollIntervalMs"
		| "pollMaxAttempts"
		| "outputFormat"
	>
> = {
	name: "Poyo AI",
	submitPath: "/api/generate/submit",
	submitMethod: "POST",
	submitBodyTemplate: JSON.stringify(
		{
			model: "{{model}}",
			input: {
				prompt: "{{prompt}}",
				size: "1:1",
			},
		},
		null,
		2,
	),
	taskIdPath: "data.task_id",
	pollPath: "/api/generate/status/{{taskId}}",
	pollMethod: "GET",
	statusPath: "data.status",
	successStatus: "finished",
	failureStatus: "failed",
	imageUrlPath: "data.files.0.file_url",
	errorPath: "data.error",
	pollIntervalMs: 5000,
	pollMaxAttempts: 60,
	outputFormat: "png",
}

export const CLOUDFLARE_IMAGE_PROVIDER_PRESET: Required<
	Pick<
		CustomImageProviderConfig,
		| "name"
		| "presetId"
		| "directPath"
		| "directBodyTemplate"
		| "directImagePath"
		| "directErrorPath"
		| "outputFormat"
	>
> = {
	name: "Cloudflare Workers AI",
	presetId: "cloudflare-workers-ai",
	directPath: "/{{model}}",
	directBodyTemplate: JSON.stringify({ prompt: "{{prompt}}" }, null, 2),
	directImagePath: "",
	directErrorPath: "errors.0.message",
	outputFormat: "png",
}

export const OPENAI_IMAGES_PROVIDER_PRESET: Required<Pick<CustomImageProviderConfig, "name" | "presetId">> = {
	name: "OpenAI-compatible Images API",
	presetId: "openai-images",
}

export const OPENAI_CHAT_IMAGE_PROVIDER_PRESET: Required<Pick<CustomImageProviderConfig, "name" | "presetId">> = {
	name: "OpenAI-compatible Chat Completions",
	presetId: "openai-chat",
}

export const IMAGE_GENERATION_CUSTOM_PROVIDER_PRESETS = [
	{ id: "cloudflare-workers-ai", label: "Cloudflare Workers AI", apiMethod: "direct_post" as const },
	{ id: "poyo-ai", label: "Poyo AI", apiMethod: "async_submit_poll" as const },
	{ id: "openai-images", label: "OpenAI-compatible Images API", apiMethod: "images_api" as const },
	{ id: "openai-chat", label: "OpenAI-compatible Chat Completions", apiMethod: "chat_completions" as const },
	{ id: "manual", label: "Manual / Advanced", apiMethod: "direct_post" as const },
] satisfies Array<{ id: CustomImageProviderPresetId; label: string; apiMethod: ImageGenerationApiMethod }>

export const CLOUDFLARE_IMAGE_MODELS: ImageGenerationModelPreset[] = [
	{ value: "@cf/stabilityai/stable-diffusion-xl-base-1.0", label: "Stable Diffusion XL Base 1.0" },
	{ value: "@cf/black-forest-labs/flux-2-klein-9b", label: "FLUX 2 Klein 9B" },
	{ value: "@cf/black-forest-labs/flux-1-schnell", label: "FLUX 1 Schnell" },
	{ value: "@cf/lykon/dreamshaper-8-lcm", label: "DreamShaper 8 LCM" },
]

export const OPENAI_IMAGE_MODELS: ImageGenerationModelPreset[] = [
	{ value: "gpt-image-1", label: "GPT Image 1" },
	{ value: "gpt-image-2", label: "GPT Image 2" },
	{ value: "dall-e-3", label: "DALL-E 3" },
]

export const IMAGE_GENERATION_PROVIDER_MODEL_PRESETS: Record<string, ImageGenerationModelPreset[]> = {
	"cloudflare-workers-ai": CLOUDFLARE_IMAGE_MODELS,
	"openai-images": OPENAI_IMAGE_MODELS,
	"openai-chat": OPENAI_IMAGE_MODELS,
}

/**
 * Default preset models for OpenRouter. Users can also enter any model ID
 * returned by their compatible endpoint or type one manually.
 */
export const IMAGE_GENERATION_OPENROUTER_PRESET_MODELS: ImageGenerationPresetModel[] = [
	{ value: "google/gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" },
	{ value: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview" },
	{ value: "openai/gpt-5-image", label: "GPT-5 Image" },
	{ value: "openai/gpt-5-image-mini", label: "GPT-5 Image Mini" },
	{ value: "black-forest-labs/flux.2-flex", label: "Black Forest Labs FLUX.2 Flex" },
	{ value: "black-forest-labs/flux.2-pro", label: "Black Forest Labs FLUX.2 Pro" },
]

export const IMAGE_GENERATION_VERTEX_PRESET_MODELS: ImageGenerationPresetModel[] = [
	{ value: "gemini-3-pro-image", label: "Gemini 3 Pro Image" },
	{ value: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview" },
	{ value: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image" },
	{ value: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image Preview" },
	{ value: "gemini-3.1-flash-lite-image", label: "Gemini 3.1 Flash Lite Image" },
	{ value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" },
	{ value: "imagen-4.0-ultra-generate-001", label: "Imagen 4 Ultra" },
]

export const IMAGE_GENERATION_GOOGLE_EXPRESS_PRESET_MODELS: ImageGenerationPresetModel[] = [
	{ value: "gemini-3-pro-image", label: "Gemini 3 Pro Image" },
	{ value: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview" },
	{ value: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image" },
	{ value: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image Preview" },
	{ value: "gemini-3.1-flash-lite-image", label: "Gemini 3.1 Flash Lite Image" },
	{ value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" },
	{ value: "imagen-4.0-ultra-generate-001", label: "Imagen 4 Ultra" },
]

/**
 * Backwards-compatible aliases for older callers/tests. These are preset
 * defaults, not the complete provider/model source of truth.
 */
export const IMAGE_GENERATION_MODELS = IMAGE_GENERATION_OPENROUTER_PRESET_MODELS.map((model) => ({
	...model,
	provider: IMAGE_GENERATION_DEFAULT_PROVIDER,
}))
export const IMAGE_GENERATION_MODEL_IDS = IMAGE_GENERATION_OPENROUTER_PRESET_MODELS.map((model) => model.value)

export function getImageGenerationProvider(
	explicitProvider: ImageGenerationProvider | LegacyImageGenerationProvider | undefined,
	_hasExistingModel: boolean,
): ImageGenerationProvider {
	return explicitProvider === "openai-compatible" ||
		explicitProvider === "vertex-ai" ||
		explicitProvider === "google-express" ||
		explicitProvider === "custom"
		? explicitProvider
		: IMAGE_GENERATION_DEFAULT_PROVIDER
}
