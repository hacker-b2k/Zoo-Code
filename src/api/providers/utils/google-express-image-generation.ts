import { t } from "../../../i18n"
import type { ImageGenerationResult } from "./image-generation"

export interface GoogleExpressImageGenerationOptions {
	apiKey?: string
	model: string
	prompt: string
	inputImage?: string
}

interface GoogleExpressPredictResponse {
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

export function buildGoogleExpressImageEndpoint(model: string): string {
	const normalizedModel = model.replace(/^models\//, "")
	return `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${encodeURIComponent(normalizedModel)}:predict`
}

function buildGoogleExpressGenerateContentEndpoint(model: string): string {
	const normalizedModel = model.replace(/^models\//, "")
	return `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${encodeURIComponent(normalizedModel)}:generateContent`
}

function isGeminiImageModel(model: string): boolean {
	return model.startsWith("gemini-") && model.includes("image")
}

function getImageFormatFromMimeType(mimeType: string | undefined): "png" | "jpeg" | "jpg" {
	if (mimeType?.includes("jpeg") || mimeType?.includes("jpg")) {
		return "jpeg"
	}
	return "png"
}

async function generateWithGeminiImageModel(
	options: GoogleExpressImageGenerationOptions,
): Promise<ImageGenerationResult> {
	const apiKey = options.apiKey?.trim()
	const model = options.model?.trim()

	const requestBody: Record<string, unknown> = {
		contents: [
			{
				role: "user",
				parts: [{ text: options.prompt }],
			},
		],
		generationConfig: {
			responseModalities: ["TEXT", "IMAGE"],
			temperature: 1,
			imageConfig: {
				aspectRatio: "1:1",
				imageSize: "1K",
				outputMimeType: "image/png",
			},
		},
		safetySettings: [
			{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
			{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
			{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
			{ category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
		],
	}

	const response = await fetch(buildGoogleExpressGenerateContentEndpoint(model), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey!,
		},
		body: JSON.stringify(requestBody),
	})

	const responseText = await response.text()
	let result: GeminiGenerateContentResponse | undefined
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

	// Extract image from response parts
	const parts = result?.candidates?.[0]?.content?.parts || []
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

async function generateWithImagenModel(options: GoogleExpressImageGenerationOptions): Promise<ImageGenerationResult> {
	const apiKey = options.apiKey?.trim()
	const model = options.model?.trim()

	const response = await fetch(buildGoogleExpressImageEndpoint(model), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey!,
		},
		body: JSON.stringify({
			instances: [
				{
					prompt: options.prompt,
				},
			],
			parameters: {
				sampleCount: 1,
			},
		}),
	})

	const responseText = await response.text()
	let result: GoogleExpressPredictResponse | undefined
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
}

export async function generateImageWithGoogleExpress(
	options: GoogleExpressImageGenerationOptions,
): Promise<ImageGenerationResult> {
	const apiKey = options.apiKey?.trim()
	const model = options.model?.trim()

	if (!apiKey) {
		return { success: false, error: "Google Express API key is required for image generation." }
	}
	if (!model) {
		return { success: false, error: "Google Express image model is required for image generation." }
	}
	if (options.inputImage) {
		return {
			success: false,
			error: "Google Express image generation currently supports text-to-image prompts only.",
		}
	}

	try {
		// Route to the appropriate endpoint based on model type
		if (isGeminiImageModel(model)) {
			return await generateWithGeminiImageModel(options)
		}
		return await generateWithImagenModel(options)
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}
