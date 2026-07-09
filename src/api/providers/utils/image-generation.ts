import type { CustomImageProviderConfig } from "@roo-code/types"

import { t } from "../../../i18n"

// Image generation types
interface ImageGenerationResponse {
	choices?: Array<{
		message?: {
			content?: string
			images?: Array<{
				type?: string
				image_url?: {
					url?: string
				}
			}>
		}
	}>
	error?: {
		message?: string
		type?: string
		code?: string
	}
}

interface ImagesApiResponse {
	data?: Array<{
		b64_json?: string
		url?: string
	}>
	error?: {
		message?: string
		type?: string
		code?: string
	}
}

export interface ImageGenerationResult {
	success: boolean
	imageData?: string
	imageFormat?: string
	error?: string
}

interface ImageGenerationOptions {
	baseURL: string
	authToken: string
	model: string
	prompt: string
	inputImage?: string
	headers?: Record<string, string>
}

interface ImagesApiOptions {
	baseURL: string
	authToken: string
	model: string
	prompt: string
	inputImage?: string
	headers?: Record<string, string>
	size?: string
	quality?: string
	outputFormat?: string
}

interface CustomProviderOptions extends ImagesApiOptions {
	config?: CustomImageProviderConfig
}

function joinUrl(baseURL: string, path: string): string {
	return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
}

function getPathValue(source: unknown, path?: string): unknown {
	if (!path) {
		return undefined
	}

	return path.split(".").reduce<unknown>((current, segment) => {
		if (current == null) {
			return undefined
		}
		if (Array.isArray(current) && /^\d+$/.test(segment)) {
			return current[Number(segment)]
		}
		if (typeof current === "object") {
			return (current as Record<string, unknown>)[segment]
		}
		return undefined
	}, source)
}

function renderTemplate(template: string, values: Record<string, string | undefined>): string {
	return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) => values[key] ?? "")
}

function buildJsonBody(template: string, values: Record<string, string | undefined>): string {
	const rendered = renderTemplate(template, values)
	try {
		return JSON.stringify(JSON.parse(rendered))
	} catch {
		return rendered
	}
}

function inferImageFormatFromContentType(contentType: string | null, fallback: string): string {
	const match = contentType?.match(/image\/(png|jpeg|jpg|webp)/i)
	return match?.[1]?.toLowerCase() || fallback
}

async function externalImageUrlToDataUrl(
	url: string,
	fallbackFormat: string,
): Promise<{ dataUrl: string; format: string }> {
	if (url.startsWith("data:image/")) {
		const formatMatch = url.match(/^data:image\/(\w+);/)
		return { dataUrl: url, format: formatMatch?.[1] || fallbackFormat }
	}

	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`Failed to download generated image: HTTP ${response.status} ${response.statusText}`)
	}

	const arrayBuffer = await response.arrayBuffer()
	const format = inferImageFormatFromContentType(response.headers?.get("content-type") ?? null, fallbackFormat)
	const base64 = Buffer.from(arrayBuffer).toString("base64")
	return { dataUrl: `data:image/${format};base64,${base64}`, format }
}

function makeHeaders(authToken: string, headers: Record<string, string> = {}): Record<string, string> {
	return {
		"HTTP-Referer": "https://github.com/Zoo-Code-Org/Zoo-Code",
		"X-Title": "Zoo Code",
		...headers,
		Authorization: `Bearer ${authToken}`,
		"Content-Type": "application/json",
	}
}

/**
 * Shared image generation implementation for OpenRouter and Zoo Code Cloud providers
 */
export async function generateImageWithProvider(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
	const { baseURL, authToken, model, prompt, inputImage, headers = {} } = options

	try {
		const response = await fetch(`${baseURL}/chat/completions`, {
			method: "POST",
			headers: {
				"HTTP-Referer": "https://github.com/Zoo-Code-Org/Zoo-Code",
				"X-Title": "Zoo Code",
				...headers,
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				messages: [
					{
						role: "user",
						content: inputImage
							? [
									{
										type: "text",
										text: prompt,
									},
									{
										type: "image_url",
										image_url: {
											url: inputImage,
										},
									},
								]
							: prompt,
					},
				],
				modalities: ["image", "text"],
			}),
		})

		if (!response.ok) {
			const errorText = await response.text()
			let errorMessage = t("tools:generateImage.failedWithStatus", {
				status: response.status,
				statusText: response.statusText,
			})

			try {
				const errorJson = JSON.parse(errorText)
				if (errorJson.error?.message) {
					errorMessage = t("tools:generateImage.failedWithMessage", {
						message: errorJson.error.message,
					})
				}
			} catch {
				// Use default error message
			}
			return {
				success: false,
				error: errorMessage,
			}
		}

		const result: ImageGenerationResponse = await response.json()

		if (result.error) {
			return {
				success: false,
				error: t("tools:generateImage.failedWithMessage", {
					message: result.error.message,
				}),
			}
		}

		// Extract the generated image from the response
		const images = result.choices?.[0]?.message?.images
		if (!images || images.length === 0) {
			return {
				success: false,
				error: t("tools:generateImage.noImageGenerated"),
			}
		}

		const imageData = images[0]?.image_url?.url
		if (!imageData) {
			return {
				success: false,
				error: t("tools:generateImage.invalidImageData"),
			}
		}

		// Extract base64 data from data URL
		const base64Match = imageData.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
		if (!base64Match) {
			return {
				success: false,
				error: t("tools:generateImage.invalidImageFormat"),
			}
		}

		return {
			success: true,
			imageData: imageData,
			imageFormat: base64Match[1],
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

/**
 * Generate an image using OpenAI's Images API (/v1/images/generations)
 * Supports BFL models (Flux) with provider-specific options for image editing
 */
export async function generateImageWithImagesApi(options: ImagesApiOptions): Promise<ImageGenerationResult> {
	const { baseURL, authToken, model, prompt, inputImage, headers = {}, outputFormat = "png" } = options

	try {
		const url = `${baseURL}/images/generations`

		// Build the request body
		// For BFL models, inputImage is passed via providerOptions.blackForestLabs.inputImage
		const requestBody: Record<string, unknown> = {
			model,
			prompt,
			n: 1,
		}

		// Add optional parameters
		if (options.size) {
			requestBody.size = options.size
		}
		if (options.quality) {
			requestBody.quality = options.quality
		}

		// For BFL (Black Forest Labs) models like flux-pro-1.1, use providerOptions
		if (model.startsWith("bfl/")) {
			requestBody.providerOptions = {
				blackForestLabs: {
					outputFormat: outputFormat,
					// inputImage: Base64 encoded image or URL of image to use as reference
					...(inputImage && { inputImage }),
				},
			}
		} else {
			// For other models, use standard output_format parameter
			requestBody.output_format = outputFormat
		}

		const fetchOptions: RequestInit = {
			method: "POST",
			headers: {
				"HTTP-Referer": "https://github.com/Zoo-Code-Org/Zoo-Code",
				"X-Title": "Zoo Code",
				...headers,
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
		}

		const response = await fetch(url, fetchOptions)

		if (!response.ok) {
			const errorText = await response.text()
			let errorMessage = t("tools:generateImage.failedWithStatus", {
				status: response.status,
				statusText: response.statusText,
			})

			try {
				const errorJson = JSON.parse(errorText)
				if (errorJson.error?.message) {
					errorMessage = t("tools:generateImage.failedWithMessage", {
						message: errorJson.error.message,
					})
				}
			} catch {
				// Use default error message
			}
			return {
				success: false,
				error: errorMessage,
			}
		}

		const result: ImagesApiResponse = await response.json()

		if (result.error) {
			return {
				success: false,
				error: t("tools:generateImage.failedWithMessage", {
					message: result.error.message,
				}),
			}
		}

		// Extract the generated image from the response
		const images = result.data
		if (!images || images.length === 0) {
			return {
				success: false,
				error: t("tools:generateImage.noImageGenerated"),
			}
		}

		const imageItem = images[0]

		// Handle b64_json response (most common)
		if (imageItem?.b64_json) {
			// Convert base64 to data URL
			const dataUrl = `data:image/${outputFormat};base64,${imageItem.b64_json}`
			return {
				success: true,
				imageData: dataUrl,
				imageFormat: outputFormat,
			}
		}

		// Handle URL response (fallback)
		if (imageItem?.url) {
			// If it's already a data URL, use it directly
			if (imageItem.url.startsWith("data:image/")) {
				const formatMatch = imageItem.url.match(/^data:image\/(\w+);/)
				const format = formatMatch?.[1] || outputFormat
				return {
					success: true,
					imageData: imageItem.url,
					imageFormat: format,
				}
			}
			// For external URLs, return as-is (the caller will need to handle fetching)
			return {
				success: true,
				imageData: imageItem.url,
				imageFormat: outputFormat,
			}
		}

		return {
			success: false,
			error: t("tools:generateImage.invalidImageData"),
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

/**
 * Generic custom provider adapter for async submit/poll image APIs.
 * Supports providers like Poyo AI where generation returns a task id first,
 * then a status endpoint returns the final image URL.
 */
export async function generateImageWithCustomProvider(options: CustomProviderOptions): Promise<ImageGenerationResult> {
	const {
		baseURL,
		authToken,
		model,
		prompt,
		inputImage,
		headers = {},
		config,
		outputFormat = config?.outputFormat || "png",
	} = options

	try {
		if (!config) {
			return { success: false, error: "Custom image provider configuration is required." }
		}
		if (!config.submitPath || !config.submitBodyTemplate || !config.taskIdPath || !config.pollPath) {
			return { success: false, error: "Custom image provider submit/poll configuration is incomplete." }
		}

		const templateValues = { model, prompt, inputImage }
		const submitResponse = await fetch(joinUrl(baseURL, config.submitPath), {
			method: config.submitMethod || "POST",
			headers: makeHeaders(authToken, headers),
			body: buildJsonBody(config.submitBodyTemplate, templateValues),
		})

		if (!submitResponse.ok) {
			const errorText = await submitResponse.text()
			return {
				success: false,
				error: `Custom image provider submit failed: HTTP ${submitResponse.status} ${submitResponse.statusText}${errorText ? ` - ${errorText}` : ""}`,
			}
		}

		const submitJson = await submitResponse.json()
		const taskId = getPathValue(submitJson, config.taskIdPath)
		if (typeof taskId !== "string" || taskId.length === 0) {
			return {
				success: false,
				error: `Custom image provider did not return task id at path "${config.taskIdPath}".`,
			}
		}

		const maxAttempts = Math.max(1, config.pollMaxAttempts ?? 60)
		const intervalMs = Math.max(0, config.pollIntervalMs ?? 5000)
		const successStatus = config.successStatus || "finished"
		const failureStatus = config.failureStatus || "failed"

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			if (attempt > 1 && intervalMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, intervalMs))
			}

			const pollPath = renderTemplate(config.pollPath, { taskId })
			const pollResponse = await fetch(joinUrl(baseURL, pollPath), {
				method: config.pollMethod || "GET",
				headers: makeHeaders(authToken, headers),
			})

			if (!pollResponse.ok) {
				const errorText = await pollResponse.text()
				return {
					success: false,
					error: `Custom image provider poll failed: HTTP ${pollResponse.status} ${pollResponse.statusText}${errorText ? ` - ${errorText}` : ""}`,
				}
			}

			const pollJson = await pollResponse.json()
			const status = String(getPathValue(pollJson, config.statusPath) ?? "")

			if (status === failureStatus) {
				const providerError = getPathValue(pollJson, config.errorPath)
				return {
					success: false,
					error: `Custom image provider generation failed${providerError ? `: ${String(providerError)}` : "."}`,
				}
			}

			if (status === successStatus) {
				const imageValue = getPathValue(pollJson, config.imageUrlPath)
				if (typeof imageValue !== "string" || imageValue.length === 0) {
					return {
						success: false,
						error: `Custom image provider did not return image at path "${config.imageUrlPath}".`,
					}
				}

				const { dataUrl, format } = imageValue.startsWith("http")
					? await externalImageUrlToDataUrl(imageValue, outputFormat)
					: await externalImageUrlToDataUrl(imageValue, outputFormat)

				return { success: true, imageData: dataUrl, imageFormat: format }
			}
		}

		return { success: false, error: `Custom image provider timed out after ${maxAttempts} poll attempts.` }
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

/**
 * Generic direct POST provider adapter for APIs like Cloudflare Workers AI.
 * Supports binary image responses and JSON responses containing base64/data URLs/URLs.
 */
export async function generateImageWithDirectPostProvider(
	options: CustomProviderOptions,
): Promise<ImageGenerationResult> {
	const {
		baseURL,
		authToken,
		model,
		prompt,
		inputImage,
		headers = {},
		config,
		outputFormat = config?.outputFormat || "png",
	} = options

	try {
		if (!config?.directPath || !config.directBodyTemplate) {
			return { success: false, error: "Direct POST provider path and body template are required." }
		}

		const response = await fetch(
			joinUrl(baseURL, renderTemplate(config.directPath, { model, prompt, inputImage })),
			{
				method: "POST",
				headers: makeHeaders(authToken, headers),
				body: buildJsonBody(config.directBodyTemplate, { model, prompt, inputImage }),
			},
		)

		const contentType = response.headers?.get("content-type") ?? ""

		if (!response.ok) {
			const errorText = await response.text()
			let errorMessage = errorText
			try {
				const errorJson = JSON.parse(errorText)
				const mappedError = getPathValue(errorJson, config.directErrorPath)
				errorMessage = mappedError ? String(mappedError) : errorText
			} catch {
				// Keep raw text.
			}
			return {
				success: false,
				error: `Direct image provider failed: HTTP ${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`,
			}
		}

		if (contentType.startsWith("image/")) {
			const arrayBuffer = await response.arrayBuffer()
			const format = inferImageFormatFromContentType(contentType, outputFormat)
			return {
				success: true,
				imageData: `data:image/${format};base64,${Buffer.from(arrayBuffer).toString("base64")}`,
				imageFormat: format,
			}
		}

		const json = await response.json()
		const imageValue = getPathValue(json, config.directImagePath)
		if (typeof imageValue !== "string" || imageValue.length === 0) {
			return {
				success: false,
				error: `Direct image provider did not return image at path "${config.directImagePath}".`,
			}
		}

		if (imageValue.startsWith("data:image/") || imageValue.startsWith("http")) {
			const { dataUrl, format } = await externalImageUrlToDataUrl(imageValue, outputFormat)
			return { success: true, imageData: dataUrl, imageFormat: format }
		}

		return {
			success: true,
			imageData: `data:image/${outputFormat};base64,${imageValue}`,
			imageFormat: outputFormat,
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}
