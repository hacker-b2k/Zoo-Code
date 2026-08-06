import { describe, it, expect } from "vitest"
import { classifyApiError, formatClassifiedError } from "../error-handler"

describe("classifyApiError", () => {
	it("should classify 429 as rate_limit", () => {
		const error = Object.assign(new Error("Rate limited"), { status: 429 })
		const result = classifyApiError(error, "openai", "glm-5.2")
		expect(result.category).toBe("rate_limit")
		expect(result.isRetriable).toBe(true)
		expect(result.maxRetries).toBe(3)
	})

	it("should classify 401 as auth_failure", () => {
		const error = Object.assign(new Error("Unauthorized"), { status: 401 })
		const result = classifyApiError(error, "openai", "glm-5.2")
		expect(result.category).toBe("auth_failure")
		expect(result.isRetriable).toBe(false)
		expect(result.maxRetries).toBe(0)
	})

	it("should classify 403 as auth_failure", () => {
		const error = Object.assign(new Error("Forbidden"), { status: 403 })
		const result = classifyApiError(error, "openai", "glm-5.2")
		expect(result.category).toBe("auth_failure")
		expect(result.isRetriable).toBe(false)
	})

	it("should classify upstream 400 as upstream_failure", () => {
		const error = Object.assign(new Error("400 Upstream error while contacting the model. Please try again."), {
			status: 400,
		})
		const result = classifyApiError(error, "openai", "glm-5.2")
		expect(result.category).toBe("upstream_failure")
		expect(result.isRetriable).toBe(true)
		expect(result.maxRetries).toBe(1)
	})

	it("should classify 502 as upstream_failure", () => {
		const error = Object.assign(new Error("Bad Gateway"), { status: 502 })
		const result = classifyApiError(error, "openai", "glm-5.2")
		expect(result.category).toBe("upstream_failure")
		expect(result.maxRetries).toBe(1)
	})

	it("should classify 503 as upstream_failure", () => {
		const error = Object.assign(new Error("Service Unavailable"), { status: 503 })
		const result = classifyApiError(error, "openai", "glm-5.2")
		expect(result.category).toBe("upstream_failure")
		expect(result.maxRetries).toBe(1)
	})

	it("should classify 504 as upstream_failure", () => {
		const error = Object.assign(new Error("Gateway Timeout"), { status: 504 })
		const result = classifyApiError(error, "openai", "glm-5.2")
		expect(result.category).toBe("upstream_failure")
		expect(result.maxRetries).toBe(1)
	})

	it("should classify context_length_exceeded as context_overflow", () => {
		const error = Object.assign(new Error("context_length_exceeded"), { code: "context_length_exceeded" })
		const result = classifyApiError(error, "anthropic", "claude-3")
		expect(result.category).toBe("context_overflow")
		expect(result.isRetriable).toBe(true)
		expect(result.maxRetries).toBe(3)
	})

	it("should classify ETIMEDOUT as timeout", () => {
		const error = Object.assign(new Error("Connection timed out"), { code: "ETIMEDOUT" })
		const result = classifyApiError(error, "openai", "glm-5.2")
		expect(result.category).toBe("timeout")
		expect(result.isRetriable).toBe(true)
		expect(result.maxRetries).toBe(1)
	})

	it("should classify ECONNREFUSED as network", () => {
		const error = Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" })
		const result = classifyApiError(error, "openai", "glm-5.2")
		expect(result.category).toBe("network")
		expect(result.isRetriable).toBe(true)
		expect(result.maxRetries).toBe(2)
	})

	it("should classify unknown errors with limited retries", () => {
		const error = new Error("Something weird happened")
		const result = classifyApiError(error, "openai", "glm-5.2")
		expect(result.category).toBe("unknown")
		expect(result.isRetriable).toBe(true)
		expect(result.maxRetries).toBe(1)
	})

	it("should include provider and model in result", () => {
		const error = new Error("test")
		const result = classifyApiError(error, "zai", "zai-model-v1")
		expect(result.provider).toBe("zai")
		expect(result.model).toBe("zai-model-v1")
	})
})

describe("formatClassifiedError", () => {
	it("should format upstream_failure with suggestions", () => {
		const classified = {
			category: "upstream_failure" as const,
			status: 400,
			message: "400 Upstream error while contacting the model",
			provider: "openai",
			model: "glm-5.2",
			isRetriable: true,
			maxRetries: 1,
		}
		const result = formatClassifiedError(classified)
		expect(result).toContain("Model request failed")
		expect(result).toContain("openai")
		expect(result).toContain("glm-5.2")
		expect(result).toContain("400")
		expect(result).toContain("upstream_failure")
		expect(result).toContain("Switch to a different model")
	})

	it("should format auth_failure with API key suggestion", () => {
		const classified = {
			category: "auth_failure" as const,
			status: 401,
			message: "Unauthorized",
			provider: "openai",
			model: "gpt-4",
			isRetriable: false,
			maxRetries: 0,
		}
		const result = formatClassifiedError(classified)
		expect(result).toContain("Authentication failed")
		expect(result).toContain("API key")
	})

	it("should format rate_limit with auto-retry message", () => {
		const classified = {
			category: "rate_limit" as const,
			status: 429,
			message: "Rate limited",
			provider: "openai",
			model: "gpt-4",
			isRetriable: true,
			maxRetries: 3,
		}
		const result = formatClassifiedError(classified)
		expect(result).toContain("Rate limited")
		expect(result).toContain("automatically")
	})
})
