import {
	IMAGE_GENERATION_DEFAULT_API_METHOD,
	IMAGE_GENERATION_DEFAULT_MODEL,
	IMAGE_GENERATION_OPENROUTER_DEFAULT_BASE_URL,
	IMAGE_GENERATION_VERTEX_DEFAULT_AUTH_MODE,
	IMAGE_GENERATION_VERTEX_DEFAULT_MODEL,
	IMAGE_GENERATION_VERTEX_DEFAULT_REGION,
	type CustomImageProviderConfig,
	type ImageGenerationApiMethod,
	type ImageGenerationProvider,
	type VertexImageAuthMode,
} from "@roo-code/types"

import { DEFAULT_HEADERS } from "./constants"
import {
	generateImageWithCustomProvider,
	generateImageWithDirectPostProvider,
	generateImageWithImagesApi,
	generateImageWithProvider,
	type ImageGenerationResult,
} from "./utils/image-generation"
import { generateImageWithGoogleExpress } from "./utils/google-express-image-generation"
import { generateImageWithVertex } from "./utils/vertex-image-generation"

export interface ImageGenerationClientOptions {
	provider?: ImageGenerationProvider
	baseUrl?: string
	apiKey?: string
	model?: string
	apiMethod?: ImageGenerationApiMethod
	headers?: Record<string, string>
	customProvider?: CustomImageProviderConfig
	vertexProjectId?: string
	vertexRegion?: string
	vertexModel?: string
	vertexAuthMode?: VertexImageAuthMode
	vertexAccessToken?: string
	vertexServiceAccountJson?: string
}

export interface GenerateImageOptions {
	prompt: string
	inputImage?: string
}

export class ImageGenerationClient {
	private readonly provider: ImageGenerationProvider
	private readonly baseUrl: string
	private readonly apiKey: string
	private readonly model: string
	private readonly apiMethod: ImageGenerationApiMethod
	private readonly headers: Record<string, string>
	private readonly customProvider?: CustomImageProviderConfig
	private readonly vertexProjectId?: string
	private readonly vertexRegion: string
	private readonly vertexModel: string
	private readonly vertexAuthMode: VertexImageAuthMode
	private readonly vertexAccessToken?: string
	private readonly vertexServiceAccountJson?: string

	constructor(options: ImageGenerationClientOptions) {
		this.provider = options.provider || "openai-compatible"
		this.baseUrl = (options.baseUrl || IMAGE_GENERATION_OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "")
		this.apiKey = options.apiKey ?? ""
		this.model = options.model || IMAGE_GENERATION_DEFAULT_MODEL
		this.apiMethod = options.apiMethod || IMAGE_GENERATION_DEFAULT_API_METHOD
		this.headers = {
			...DEFAULT_HEADERS,
			...(options.headers || {}),
		}
		this.customProvider = options.customProvider
		this.vertexProjectId = options.vertexProjectId
		this.vertexRegion = options.vertexRegion || IMAGE_GENERATION_VERTEX_DEFAULT_REGION
		this.vertexModel = options.vertexModel || IMAGE_GENERATION_VERTEX_DEFAULT_MODEL
		this.vertexAuthMode = options.vertexAuthMode || IMAGE_GENERATION_VERTEX_DEFAULT_AUTH_MODE
		this.vertexAccessToken = options.vertexAccessToken
		this.vertexServiceAccountJson = options.vertexServiceAccountJson
	}

	async generateImage(options: GenerateImageOptions): Promise<ImageGenerationResult> {
		if (this.provider === "vertex-ai") {
			// For api_key auth mode, fall back to the general API key if vertex-specific one isn't set
			const accessToken =
				this.vertexAuthMode === "api_key" && !this.vertexAccessToken ? this.apiKey : this.vertexAccessToken
			return generateImageWithVertex({
				projectId: this.vertexProjectId,
				region: this.vertexRegion,
				model: this.vertexModel,
				authMode: this.vertexAuthMode,
				accessToken,
				serviceAccountJson: this.vertexServiceAccountJson,
				prompt: options.prompt,
				inputImage: options.inputImage,
			})
		}

		if (this.provider === "google-express") {
			return generateImageWithGoogleExpress({
				apiKey: this.apiKey,
				model: this.model,
				prompt: options.prompt,
				inputImage: options.inputImage,
			})
		}

		if (!this.apiKey) {
			return {
				success: false,
				error: "API key is required for image generation.",
			}
		}

		const requestOptions = {
			baseURL: this.baseUrl,
			authToken: this.apiKey,
			model: this.model,
			prompt: options.prompt,
			inputImage: options.inputImage,
			headers: this.headers,
		}

		if (this.provider === "custom" && this.apiMethod === "async_submit_poll") {
			return generateImageWithCustomProvider({ ...requestOptions, config: this.customProvider })
		}

		if (this.provider === "custom" && this.apiMethod === "direct_post") {
			return generateImageWithDirectPostProvider({ ...requestOptions, config: this.customProvider })
		}

		if (this.apiMethod === "images_api") {
			return generateImageWithImagesApi(requestOptions)
		}

		return generateImageWithProvider(requestOptions)
	}
}
