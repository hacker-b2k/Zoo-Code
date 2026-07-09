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

export function buildGoogleExpressImageEndpoint(model: string, apiKey: string): string {
	const normalizedModel = model.replace(/^models\//, "")
	return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:predict?key=${encodeURIComponent(apiKey)}`
}

function getImageFormatFromMimeType(mimeType: string | undefined): "png" | "jpeg" | "jpg" {
	if (mimeType?.includes("jpeg") || mimeType?.includes("jpg")) {
		return "jpeg"
	}
	return "png"
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
		const response = await fetch(buildGoogleExpressImageEndpoint(model, apiKey), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
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
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}
