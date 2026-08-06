/**
 * General error handler for API provider errors
 * Transforms technical errors into user-friendly messages while preserving metadata
 *
 * This utility ensures consistent error handling across all API providers:
 * - Preserves HTTP status codes for UI-aware error display
 * - Maintains error details for retry logic (e.g., RetryInfo for 429 errors)
 * - Provides consistent error message formatting
 * - Enables telemetry and debugging with complete error context
 */

import i18n from "../../../i18n/setup"

/**
 * Handles API provider errors and transforms them into user-friendly messages
 * while preserving important metadata for retry logic and UI display.
 *
 * @param error - The error to handle
 * @param providerName - The name of the provider for context in error messages
 * @param options - Optional configuration for error handling
 * @returns A wrapped Error with preserved metadata (status, errorDetails, code)
 *
 * @example
 * // Basic usage
 * try {
 *   await apiClient.createMessage(...)
 * } catch (error) {
 *   throw handleProviderError(error, "OpenAI")
 * }
 *
 * @example
 * // With custom message prefix
 * catch (error) {
 *   throw handleProviderError(error, "Anthropic", { messagePrefix: "streaming" })
 * }
 */
export function handleProviderError(
	error: unknown,
	providerName: string,
	options?: {
		/** Custom message prefix (default: "completion") */
		messagePrefix?: string
		/** Custom message transformer */
		messageTransformer?: (msg: string) => string
	},
): Error {
	const messagePrefix = options?.messagePrefix || "completion"

	if (error instanceof Error) {
		const anyErr = error as any
		const msg = anyErr?.error?.metadata?.raw || error.message || ""

		// Log the original error details for debugging
		console.error(`[${providerName}] API error:`, {
			message: msg,
			name: error.name,
			stack: error.stack,
			status: anyErr.status,
		})

		let wrapped: Error

		// Special case: Invalid character/ByteString conversion error in API key
		// This is specific to OpenAI-compatible SDKs
		if (msg.includes("Cannot convert argument to a ByteString")) {
			wrapped = new Error(i18n.t("common:errors.api.invalidKeyInvalidChars"))
		} else {
			// Apply custom transformer if provided, otherwise use default format
			const finalMessage = options?.messageTransformer
				? options.messageTransformer(msg)
				: `${providerName} ${messagePrefix} error: ${msg}`
			wrapped = new Error(finalMessage)
		}

		// Preserve HTTP status and structured details for retry/backoff + UI
		// These fields are used by Task.backoffAndAnnounce() and ChatRow/ErrorRow
		// to provide status-aware error messages and handling
		if (anyErr.status !== undefined) {
			;(wrapped as any).status = anyErr.status
		}
		if (anyErr.errorDetails !== undefined) {
			;(wrapped as any).errorDetails = anyErr.errorDetails
		}
		if (anyErr.code !== undefined) {
			;(wrapped as any).code = anyErr.code
		}
		// Preserve AWS-specific metadata if present (for Bedrock)
		if (anyErr.$metadata !== undefined) {
			;(wrapped as any).$metadata = anyErr.$metadata
		}

		return wrapped
	}

	// Non-Error: wrap with provider-specific prefix
	console.error(`[${providerName}] Non-Error exception:`, error)
	const wrapped = new Error(`${providerName} ${messagePrefix} error: ${String(error)}`)

	// Also try to preserve status for non-Error exceptions (e.g., plain objects with status)
	const anyErr = error as any
	if (typeof anyErr?.status === "number") {
		;(wrapped as any).status = anyErr.status
	}

	return wrapped
}

/** Error category for classification of API failures. */
export type ApiErrorCategory =
	| "upstream_failure" // Upstream server returned an error (400, 502, 503, 504)
	| "rate_limit" // Rate limited (429)
	| "auth_failure" // Authentication/authorization (401, 403)
	| "context_overflow" // Context window exceeded
	| "timeout" // Request timed out
	| "network" // Network/connectivity error
	| "unknown" // Unclassified

export interface ClassifiedApiError {
	category: ApiErrorCategory
	status?: number
	message: string
	provider: string
	model?: string
	isRetriable: boolean
	maxRetries: number
}

/**
 * Classify an API error into a category with retry semantics.
 *
 * This helps the retry logic make intelligent decisions:
 * - upstream_failure (400/502/503/504): max 1 retry, often model incompatibility
 * - rate_limit (429): retriable with backoff
 * - auth_failure (401/403): NOT retriable
 * - context_overflow: retriable with truncation
 * - timeout: retriable once
 * - network: retriable with backoff
 */
export function classifyApiError(error: unknown, providerName: string, modelId?: string): ClassifiedApiError {
	const anyErr = error as any
	const status = typeof anyErr?.status === "number" ? anyErr.status : undefined
	const message = anyErr?.message || String(error)
	const model = modelId || "unknown"

	// Detect upstream errors from proxy messages
	const isUpstreamError =
		message.includes("Upstream error") ||
		message.includes("upstream") ||
		message.includes("Bad Gateway") ||
		message.includes("Service Unavailable") ||
		message.includes("Gateway Timeout")

	// Rate limit
	if (status === 429) {
		return {
			category: "rate_limit",
			status,
			message,
			provider: providerName,
			model,
			isRetriable: true,
			maxRetries: 3,
		}
	}

	// Auth failure — never retry
	if (status === 401 || status === 403) {
		return {
			category: "auth_failure",
			status,
			message,
			provider: providerName,
			model,
			isRetriable: false,
			maxRetries: 0,
		}
	}

	// Context window overflow — retriable with truncation
	if (
		anyErr?.code === "context_length_exceeded" ||
		message.includes("context_length_exceeded") ||
		message.includes("context window")
	) {
		return {
			category: "context_overflow",
			status,
			message,
			provider: providerName,
			model,
			isRetriable: true,
			maxRetries: 3,
		}
	}

	// Upstream failure (400 with upstream message, 502, 503, 504)
	if (isUpstreamError || status === 502 || status === 503 || status === 504) {
		return {
			category: "upstream_failure",
			status,
			message,
			provider: providerName,
			model,
			isRetriable: true,
			maxRetries: 1,
		}
	}

	// 400 from upstream model (e.g., "400 Upstream error while contacting the model")
	if (status === 400 && isUpstreamError) {
		return {
			category: "upstream_failure",
			status,
			message,
			provider: providerName,
			model,
			isRetriable: true,
			maxRetries: 1,
		}
	}

	// Timeout
	if (
		anyErr?.code === "ETIMEDOUT" ||
		anyErr?.code === "ECONNABORTED" ||
		message.includes("timeout") ||
		message.includes("ETIMEDOUT")
	) {
		return { category: "timeout", status, message, provider: providerName, model, isRetriable: true, maxRetries: 1 }
	}

	// Network errors
	if (
		anyErr?.code === "ECONNREFUSED" ||
		anyErr?.code === "ECONNRESET" ||
		anyErr?.code === "ENOTFOUND" ||
		message.includes("ECONNREFUSED") ||
		message.includes("Connection refused")
	) {
		return { category: "network", status, message, provider: providerName, model, isRetriable: true, maxRetries: 2 }
	}

	// Default: unknown — limit retries to be safe
	return { category: "unknown", status, message, provider: providerName, model, isRetriable: true, maxRetries: 1 }
}

/**
 * Format a classified error into a user-friendly diagnostic message.
 */
export function formatClassifiedError(classified: ClassifiedApiError): string {
	const parts: string[] = []

	parts.push(`Model request failed`)
	parts.push(``)
	parts.push(`Provider: ${classified.provider}`)
	parts.push(`Model: ${classified.model}`)

	if (classified.status) {
		parts.push(`Status: ${classified.status}`)
	}

	parts.push(`Category: ${classified.category}`)

	switch (classified.category) {
		case "upstream_failure":
			parts.push(``)
			parts.push(`The upstream model provider returned an error. This is usually a temporary`)
			parts.push(`availability or compatibility issue with the specific model.`)
			parts.push(``)
			parts.push(`Suggested actions:`)
			parts.push(`1. Retry once — the issue may be temporary`)
			parts.push(`2. Switch to a different model if the problem persists`)
			parts.push(`3. Check the model provider's status page`)
			break
		case "rate_limit":
			parts.push(``)
			parts.push(`Rate limited by the provider. Will retry automatically with backoff.`)
			break
		case "auth_failure":
			parts.push(``)
			parts.push(`Authentication failed. Check your API key configuration.`)
			break
		case "timeout":
			parts.push(``)
			parts.push(`The request timed out. This may be due to high server load.`)
			break
		case "network":
			parts.push(``)
			parts.push(`Network connectivity issue. Check your internet connection.`)
			break
		default:
			parts.push(``)
			parts.push(`An unexpected error occurred. Will retry once.`)
	}

	return parts.join("\n")
}

/**
 * Specialized handler for OpenAI-compatible providers
 * Re-exports with OpenAI-specific defaults for backward compatibility
 */
export function handleOpenAIError(error: unknown, providerName: string): Error {
	return handleProviderError(error, providerName, { messagePrefix: "completion" })
}
