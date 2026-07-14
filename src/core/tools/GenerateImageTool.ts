import path from "path"
import fs from "fs/promises"
import * as vscode from "vscode"
import {
	GenerateImageParams,
	IMAGE_GENERATION_DEFAULT_API_METHOD,
	IMAGE_GENERATION_DEFAULT_MODEL,
	IMAGE_GENERATION_DEFAULT_PROVIDER,
	IMAGE_GENERATION_OPENROUTER_DEFAULT_BASE_URL,
	IMAGE_GENERATION_GOOGLE_EXPRESS_DEFAULT_MODEL,
	IMAGE_GENERATION_VERTEX_DEFAULT_AUTH_MODE,
	IMAGE_GENERATION_VERTEX_DEFAULT_MODEL,
	IMAGE_GENERATION_VERTEX_DEFAULT_REGION,
} from "@roo-code/types"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { ImageGenerationClient } from "../../api/providers/image-generation"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

export class GenerateImageTool extends BaseTool<"generate_image"> {
	readonly name = "generate_image" as const

	async execute(params: GenerateImageParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { prompt, path: relPath, image: inputImagePath } = params
		const { handleError, pushToolResult, askApproval } = callbacks

		const provider = task.providerRef.deref()
		const state = await provider?.getState()
		const isImageGenerationEnabled = experiments.isEnabled(
			state?.experiments ?? {},
			EXPERIMENT_IDS.IMAGE_GENERATION,
		)

		if (!isImageGenerationEnabled) {
			pushToolResult(
				formatResponse.toolError(
					"Image generation is an experimental feature that must be enabled in settings. Please enable 'Image Generation' in the Experimental Settings section.",
				),
			)
			return
		}

		if (!prompt) {
			task.consecutiveMistakeCount++
			task.recordToolError("generate_image")
			pushToolResult(await task.sayAndCreateMissingParamError("generate_image", "prompt"))
			return
		}

		if (!relPath) {
			task.consecutiveMistakeCount++
			task.recordToolError("generate_image")
			pushToolResult(await task.sayAndCreateMissingParamError("generate_image", "path"))
			return
		}

		const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
		if (!accessAllowed) {
			await task.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		let inputImageData: string | undefined
		if (inputImagePath) {
			const inputImageFullPath = path.resolve(task.cwd, inputImagePath)

			const inputImageExists = await fileExistsAtPath(inputImageFullPath)
			if (!inputImageExists) {
				await task.say("error", `Input image not found: ${getReadablePath(task.cwd, inputImagePath)}`)
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(`Input image not found: ${getReadablePath(task.cwd, inputImagePath)}`),
				)
				return
			}

			const inputImageAccessAllowed = task.rooIgnoreController?.validateAccess(inputImagePath)
			if (!inputImageAccessAllowed) {
				await task.say("rooignore_error", inputImagePath)
				pushToolResult(formatResponse.rooIgnoreError(inputImagePath))
				return
			}

			try {
				const imageBuffer = await fs.readFile(inputImageFullPath)
				const imageExtension = path.extname(inputImageFullPath).toLowerCase().replace(".", "")

				const supportedFormats = ["png", "jpg", "jpeg", "gif", "webp"]
				if (!supportedFormats.includes(imageExtension)) {
					await task.say(
						"error",
						`Unsupported image format: ${imageExtension}. Supported formats: ${supportedFormats.join(", ")}`,
					)
					task.didToolFailInCurrentTurn = true
					pushToolResult(
						formatResponse.toolError(
							`Unsupported image format: ${imageExtension}. Supported formats: ${supportedFormats.join(", ")}`,
						),
					)
					return
				}

				const mimeType = imageExtension === "jpg" ? "jpeg" : imageExtension
				inputImageData = `data:image/${mimeType};base64,${imageBuffer.toString("base64")}`
			} catch (error) {
				await task.say(
					"error",
					`Failed to read input image: ${error instanceof Error ? error.message : "Unknown error"}`,
				)
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Failed to read input image: ${error instanceof Error ? error.message : "Unknown error"}`,
					),
				)
				return
			}
		}

		const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

		const imageProvider = state?.imageGenerationProvider || IMAGE_GENERATION_DEFAULT_PROVIDER
		const defaultSelectedModel =
			imageProvider === "google-express"
				? IMAGE_GENERATION_GOOGLE_EXPRESS_DEFAULT_MODEL
				: IMAGE_GENERATION_DEFAULT_MODEL
		const selectedModel =
			state?.imageGenerationSelectedModel || state?.openRouterImageGenerationSelectedModel || defaultSelectedModel
		const apiKey = state?.imageGenerationApiKey || state?.openRouterImageApiKey
		const baseUrl = state?.imageGenerationBaseUrl || IMAGE_GENERATION_OPENROUTER_DEFAULT_BASE_URL
		const apiMethod = state?.imageGenerationApiMethod || IMAGE_GENERATION_DEFAULT_API_METHOD
		const savedVertexAuthMode = state?.vertexImageAuthMode || IMAGE_GENERATION_VERTEX_DEFAULT_AUTH_MODE
		// If auth mode is access_token but no access token is set and an API key exists,
		// auto-upgrade to api_key mode (Express Mode) since the user has an API key
		const vertexAuthMode =
			savedVertexAuthMode === "access_token" && !state?.vertexImageAccessToken && apiKey
				? "api_key"
				: savedVertexAuthMode
		const vertexCredential =
			vertexAuthMode === "service_account_json"
				? state?.vertexImageServiceAccountJson
				: state?.vertexImageAccessToken

		if (imageProvider !== "vertex-ai" && !apiKey) {
			const errorMessage = t("tools:generateImage.apiKeyRequired")
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		if (imageProvider === "vertex-ai" && !vertexCredential && vertexAuthMode !== "api_key") {
			const errorMessage = "Vertex AI credentials are required for image generation."
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		if (imageProvider === "vertex-ai" && vertexAuthMode === "api_key" && !vertexCredential && !apiKey) {
			const errorMessage = "Vertex AI API key is required for image generation. Please set an API key."
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		const fullPath = path.resolve(task.cwd, relPath)
		const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

		const sharedMessageProps = {
			tool: "generateImage" as const,
			path: getReadablePath(task.cwd, relPath),
			content: prompt,
			isOutsideWorkspace,
			isProtected: isWriteProtected,
		}

		try {
			task.consecutiveMistakeCount = 0

			const approvalMessage = JSON.stringify({
				...sharedMessageProps,
				content: prompt,
				...(inputImagePath && { inputImage: getReadablePath(task.cwd, inputImagePath) }),
			})

			const didApprove = await askApproval("tool", approvalMessage, undefined, isWriteProtected)

			if (!didApprove) {
				return
			}

			const imageGenerationClient = new ImageGenerationClient({
				provider:
					imageProvider === "vertex-ai" || imageProvider === "google-express" || imageProvider === "custom"
						? imageProvider
						: "openai-compatible",
				baseUrl,
				apiKey,
				model: selectedModel,
				apiMethod,
				headers: state?.imageGenerationHeaders,
				customProvider: state?.imageGenerationCustomProvider,
				vertexProjectId: state?.vertexImageProjectId,
				vertexRegion: state?.vertexImageRegion || IMAGE_GENERATION_VERTEX_DEFAULT_REGION,
				vertexModel: state?.vertexImageModel || IMAGE_GENERATION_VERTEX_DEFAULT_MODEL,
				vertexAuthMode,
				vertexAccessToken: state?.vertexImageAccessToken,
				vertexServiceAccountJson: state?.vertexImageServiceAccountJson,
			})
			const result = await imageGenerationClient.generateImage({ prompt, inputImage: inputImageData })

			if (!result.success) {
				await task.say("error", result.error || "Failed to generate image")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(result.error || "Failed to generate image"))
				return
			}

			if (!result.imageData) {
				const errorMessage = "No image data received"
				await task.say("error", errorMessage)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const base64Match = result.imageData.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
			if (!base64Match) {
				const errorMessage = "Invalid image format received"
				await task.say("error", errorMessage)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const imageFormat = base64Match[1]
			const base64Data = base64Match[2]

			let finalPath = relPath
			if (!finalPath.match(/\.(png|jpg|jpeg)$/i)) {
				finalPath = `${finalPath}.${imageFormat === "jpeg" ? "jpg" : imageFormat}`
			}

			const imageBuffer = Buffer.from(base64Data, "base64")

			const absolutePath = path.resolve(task.cwd, finalPath)
			const directory = path.dirname(absolutePath)
			await fs.mkdir(directory, { recursive: true })

			await fs.writeFile(absolutePath, imageBuffer)

			if (finalPath) {
				await task.fileContextTracker.trackFileContext(finalPath, "roo_edited")
			}

			task.didEditFile = true

			task.recordToolUsage("generate_image")

			const fullImagePath = path.join(task.cwd, finalPath)

			let imageUri = provider?.convertToWebviewUri?.(fullImagePath) ?? vscode.Uri.file(fullImagePath).toString()

			const cacheBuster = Date.now()
			imageUri = imageUri.includes("?") ? `${imageUri}&t=${cacheBuster}` : `${imageUri}?t=${cacheBuster}`

			await task.say("image", JSON.stringify({ imageUri, imagePath: fullImagePath }))
			pushToolResult(formatResponse.toolResult(getReadablePath(task.cwd, finalPath)))
		} catch (error) {
			await handleError("generating image", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"generate_image">): Promise<void> {
		return
	}
}

export const generateImageTool = new GenerateImageTool()
