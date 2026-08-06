import OpenAI from "openai"

import { DEFAULT_HEADERS } from "./constants"

/**
 * Fetches models from a custom endpoint, trying standard OpenAI-compatible
 * format first, then falling back to provider-specific formats.
 */
export async function getCustomEndpointModels(baseUrl?: string, apiKey?: string): Promise<string[]> {
	if (!baseUrl) {
		return []
	}

	const headers: Record<string, string> = {
		...DEFAULT_HEADERS,
	}

	if (apiKey) {
		headers["Authorization"] = `Bearer ${apiKey}`
	}

	// Normalize base URL: remove trailing slash
	const normalizedBase = baseUrl.replace(/\/+$/, "")

	// Strategy 1: Try standard OpenAI /models endpoint
	try {
		const client = new OpenAI({ baseURL: normalizedBase, apiKey: apiKey || "not-provided" })
		const models = await client.models.list()
		const modelIds = models.data.map((m) => m.id).filter(Boolean)
		if (modelIds.length > 0) {
			return [...new Set(modelIds)]
		}
	} catch {
		// Fall through to alternative strategies
	}

	// Strategy 2: Try the URL as-is + /models (some providers use /v1/models
	// while the base URL is just /v1)
	try {
		const response = await fetch(`${normalizedBase}/models`, {
			headers,
			signal: AbortSignal.timeout(10_000),
		})
		if (response.ok) {
			const data = await response.json()
			const models = data?.data ?? data?.models ?? data?.result ?? []
			const modelIds = (Array.isArray(models) ? models : [])
				.map((m: any) => m.id ?? m.name ?? m)
				.filter((id: any) => typeof id === "string")
			if (modelIds.length > 0) {
				return [...new Set(modelIds)]
			}
		}
	} catch {
		// Fall through
	}

	// Strategy 3: Cloudflare Workers AI pattern
	// Base URL: https://api.cloudflare.com/client/v4/accounts/{id}/ai/v1
	// Models:   https://api.cloudflare.com/client/v4/accounts/{id}/ai/models/search
	if (normalizedBase.includes("api.cloudflare.com")) {
		try {
			// Extract the account-level AI URL by stripping /v1 suffix
			const cfModelsUrl = normalizedBase.replace(/\/ai\/v1$/, "/ai/models/search")
			if (cfModelsUrl !== normalizedBase) {
				const response = await fetch(cfModelsUrl, {
					headers,
					signal: AbortSignal.timeout(10_000),
				})
				if (response.ok) {
					const data = await response.json()
					const models = data?.result ?? data?.data ?? []
					const chatModels = models
						.filter((m: any) => {
							const task = typeof m.task === "string" ? m.task : ""
							const name = m.name ?? ""
							// Include chat/text-generation models, skip embeddings/audio/vision-only
							return (
								task.includes("text-generation") ||
								task.includes("Text Generation") ||
								name.includes("instruct") ||
								name.includes("chat") ||
								name.includes("llm") ||
								name.includes("gpt") ||
								name.includes("llama") ||
								name.includes("gemma") ||
								name.includes("qwen") ||
								name.includes("deepseek") ||
								name.includes("mistral") ||
								name.includes("glm") ||
								name.includes("nemotron") ||
								name.includes("kimi") ||
								name.includes("granite") ||
								name.includes("moondream")
							)
						})
						.map((m: any) => m.name ?? m.id)
						.filter((id: any): id is string => typeof id === "string" && id.length > 0)
					if (chatModels.length > 0) {
						return [...new Set<string>(chatModels)]
					}
					// Return all models if filtering was too aggressive
					const allModels: string[] = models
						.map((m: any) => (m.name ?? m.id) as string)
						.filter((id: any): id is string => typeof id === "string" && id.length > 0)
					return [...new Set(allModels)]
				}
			}
		} catch {
			// Fall through
		}
	}

	return []
}
