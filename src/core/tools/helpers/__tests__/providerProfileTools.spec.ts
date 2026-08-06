// npx vitest run src/core/tools/helpers/__tests__/providerProfileTools.spec.ts

import { describe, it, expect } from "vitest"

import {
	redactProviderSettings,
	stripSecretsFromSettings,
	listProviderTypesPayload,
	isValidApiProvider,
} from "../providerProfileTools"

describe("providerProfileTools helpers", () => {
	describe("redactProviderSettings", () => {
		it("replaces secret strings with present flags and never echoes values", () => {
			const redacted = redactProviderSettings({
				apiProvider: "openai",
				openAiBaseUrl: "https://api.example.com/v1",
				openAiModelId: "gpt-test",
				openAiApiKey: "sk-super-secret-key",
				apiKey: "anthropic-secret",
			})

			expect(redacted.apiProvider).toBe("openai")
			expect(redacted.openAiBaseUrl).toBe("https://api.example.com/v1")
			expect(redacted.openAiApiKey).toEqual({ present: true })
			expect(redacted.apiKey).toEqual({ present: true })
			expect(JSON.stringify(redacted)).not.toContain("sk-super-secret-key")
			expect(JSON.stringify(redacted)).not.toContain("anthropic-secret")
		})

		it("marks empty secrets as not present", () => {
			const redacted = redactProviderSettings({
				openAiApiKey: "",
				openRouterApiKey: undefined,
			})
			expect(redacted.openAiApiKey).toEqual({ present: false })
		})
	})

	describe("stripSecretsFromSettings", () => {
		it("splits secret keys into secrets map", () => {
			const { nonSecret, secrets } = stripSecretsFromSettings({
				apiProvider: "openai",
				openAiModelId: "m",
				openAiApiKey: "sk-x",
			})
			expect(nonSecret).toEqual({ apiProvider: "openai", openAiModelId: "m" })
			expect(secrets).toEqual({ openAiApiKey: "sk-x" })
		})
	})

	describe("listProviderTypesPayload", () => {
		it("returns compact commonProviders with openai hints and quickMap (no full secret dump)", () => {
			const payload = listProviderTypesPayload()
			expect(payload.commonProviders.some((p) => p.apiProvider === "openai")).toBe(true)
			const openai = payload.commonProviders.find((p) => p.apiProvider === "openai")
			expect(openai?.fields.secretKeys).toContain("openAiApiKey")
			expect(payload.commonProviders.some((p) => p.apiProvider === "custom-endpoint")).toBe(true)
			expect(payload.quickMap.unknownProtocol.apiProvider).toBe("custom-endpoint")
			expect(payload.skipWhen).toMatch(/manage_provider_profile/)
			expect(payload.notes.length).toBeGreaterThan(0)
			// Must stay small — no per-provider SECRET_STATE_KEYS dump
			expect((payload as { secretKeys?: unknown }).secretKeys).toBeUndefined()
			expect((payload as { providers?: unknown }).providers).toBeUndefined()
		})
	})

	describe("isValidApiProvider", () => {
		it("accepts known providers and rejects junk", () => {
			expect(isValidApiProvider("openai")).toBe(true)
			expect(isValidApiProvider("openrouter")).toBe(true)
			expect(isValidApiProvider("not-a-provider")).toBe(false)
		})
	})
})
