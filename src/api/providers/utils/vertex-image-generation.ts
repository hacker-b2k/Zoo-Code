import { GoogleAuth } from "google-auth-library"

import type { VertexImageAuthMode } from "@roo-code/types"
import { t } from "../../../i18n"
import { parseVertexJsonCredentials } from "./vertex-credentials"
import type { ImageGenerationResult } from "./image-generation"

const VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform"

export interface VertexImageGenerationOptions {
	projectId?: string
	region?: string
	model: string
	prompt: string
	inputImage?: string
	authMode?: VertexImageAuthMode
	accessToken?: string
	serviceAccountJson?: string
}

interface VertexPredictResponse {
	predictions?: Array<{
		bytesBase64Encoded?: string
		mimeType?: string
		safetyAttributes?: unknown
	}>
	error?: {
		message?: string
		code?: number | string
		status?: string
	}
}

interface GeminiGenerateContentResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string
				inlineData?: {
					data?: string
					mimeType?: string
				}
			}>
		}
		finishReason?: string
	}>
	error?: {
		message?: string
		code?: number | string
		status?: string
	}
}

export function buildVertexImageEndpoint(projectId: string, region: string, model: string): string {
	const encodedProjectId = encodeURIComponent(projectId)
	const encodedModel = encodeURIComponent(model)
	return `https://${region}-aiplatform.googleapis.com/v1/projects/${encodedProjectId}/locations/${region}/publishers/google/models/${encodedModel}:predict`
}

function getImageFormatFromMimeType(mimeType: string | undefined): "png" | "jpeg" | "jpg" {
	if (mimeType?.includes("jpeg") || mimeType?.includes("jpg")) {
		return "jpeg"
	}
	return "png"
}

function isGeminiImageModel(model: string): boolean {
	return model.startsWith("gemini-") && model.includes("image")
}

async function getVertexAccessToken(options: VertexImageGenerationOptions): Promise<string> {
	const authMode = options.authMode ?? "access_token"

	if (authMode === "api_key") {
		throw new Error("api_key auth mode does not use access tokens. Use generateImageWithVertexApiKey instead.")
	}

	if (authMode === "access_token") {
		const token = options.accessToken?.trim()
		if (!token) {
			throw new Error("Vertex AI access token is required for access-token authentication.")
		}
		return token
	}

	const credentials = parseVertexJsonCredentials(options.serviceAccountJson)
	if (!credentials) {
		throw new Error("Valid Vertex AI service account JSON is required for service-account authentication.")
	}

	const auth = new GoogleAuth({
		scopes: [VERTEX_SCOPE],
		credentials,
	})
	const client = await auth.getClient()
	const tokenResponse = await client.getAccessToken()
	const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token

	if (!token) {
		throw new Error("Failed to obtain a Vertex AI access token from service account credentials.")
	}

	return token
}

export async function generateImageWithVertex(options: VertexImageGenerationOptions): Promise<ImageGenerationResult> {
	const projectId = options.projectId?.trim()
	const region = options.region?.trim()
	const model = options.model?.trim()

	if (!model) {
		return { success: false, error: "Vertex AI model is required for image generation." }
	}

	try {
		const authMode = options.authMode ?? "access_token"
		let headers: Record<string, string>
		let endpoint: string

		if (authMode === "api_key") {
			const apiKey = options.accessToken?.trim()
			if (!apiKey) {
				return { success: false, error: "Vertex AI API key is required for api-key authentication." }
			}

			// Gemini image models use generateContent endpoint
			if (isGeminiImageModel(model)) {
				const endpoint = `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${encodeURIComponent(model)}:generateContent`
				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-goog-api-key": apiKey,
					},
					body: JSON.stringify({
						contents: [{ role: "user", parts: [{ text: options.prompt }] }],
						generationConfig: {
							responseModalities: ["TEXT", "IMAGE"],
							temperature: 1,
							imageConfig: { aspectRatio: "1:1", imageSize: "1K", outputMimeType: "image/png" },
						},
						safetySettings: [
							{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
							{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
							{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
							{ category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
						],
					}),
				})
				const responseText = await response.text()
				let geminiResult: GeminiGenerateContentResponse | undefined
				try {
					geminiResult = responseText ? JSON.parse(responseText) : undefined
				} catch {
					geminiResult = undefined
				}
				if (!response.ok) {
					return {
						success: false,
						error:
							geminiResult?.error?.message ||
							t("tools:generateImage.failedWithStatus", {
								status: response.status,
								statusText: response.statusText,
							}),
					}
				}
				const parts = geminiResult?.candidates?.[0]?.content?.parts || []
				for (const part of parts) {
					if (part.inlineData?.data) {
						const format = getImageFormatFromMimeType(part.inlineData.mimeType)
						return {
							success: true,
							imageData: `data:image/${format};base64,${part.inlineData.data}`,
							imageFormat: format,
						}
					}
				}
				return { success: false, error: t("tools:generateImage.noImageGenerated") }
			}

			// Imagen models use predict endpoint
			endpoint = `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${encodeURIComponent(model)}:predict`
			headers = {
				"Content-Type": "application/json",
				"x-goog-api-key": apiKey,
			}
		} else {
			if (!projectId) {
				return { success: false, error: "Vertex AI project ID is required for image generation." }
			}
			if (!region) {
				return { success: false, error: "Vertex AI region is required for image generation." }
			}
			const accessToken = await getVertexAccessToken(options)
			endpoint = buildVertexImageEndpoint(projectId, region, model)
			headers = {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			}
		}

		const response = await fetch(endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify({
				instances: [
					{
						prompt: options.prompt,
						...(options.inputImage && {
							image: { bytesBase64Encoded: options.inputImage.split(",").pop() },
						}),
					},
				],
				parameters: {
					sampleCount: 1,
				},
			}),
		})

		const responseText = await response.text()
		let result: VertexPredictResponse | undefined
		try {
			result = responseText ? JSON.parse(responseText) : undefined
		} catch {
			result = undefined
		}

		if (!response.ok) {
			return {
				success: false,
				error:
					result?.error?.message ||
					t("tools:generateImage.failedWithStatus", {
						status: response.status,
						statusText: response.statusText,
					}),
			}
		}

		if (result?.error) {
			return {
				success: false,
				error: t("tools:generateImage.failedWithMessage", {
					message: result.error.message,
				}),
			}
		}

		const prediction = result?.predictions?.[0]
		const base64 = prediction?.bytesBase64Encoded
		if (!base64) {
			return { success: false, error: t("tools:generateImage.noImageGenerated") }
		}

		const imageFormat = getImageFormatFromMimeType(prediction?.mimeType)
		return {
			success: true,
			imageData: `data:image/${imageFormat};base64,${base64}`,
			imageFormat,
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}
