import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}))

vi.mock("../../../i18n", () => ({
	t: (key: string, options?: Record<string, unknown>) => options?.message || key,
}))

import {
	buildGoogleExpressImageEndpoint,
	generateImageWithGoogleExpress,
} from "../utils/google-express-image-generation"

describe("Google Express image generation", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		global.fetch = mocks.mockFetch as unknown as typeof fetch
	})

	it("builds the Generative Language predict endpoint with an API key", () => {
		expect(buildGoogleExpressImageEndpoint("imagen-4.0-ultra-generate-001", "test key")).toBe(
			"https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-ultra-generate-001:predict?key=test%20key",
		)
	})

	it("strips an optional models/ prefix from model IDs", () => {
		expect(buildGoogleExpressImageEndpoint("models/imagen-4.0-ultra-generate-001", "test-key")).toBe(
			"https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-ultra-generate-001:predict?key=test-key",
		)
	})

	it("uses API-key auth and normalizes a base64 prediction", async () => {
		mocks.mockFetch.mockResolvedValue({
			ok: true,
			text: vi.fn().mockResolvedValue(
				JSON.stringify({
					predictions: [{ bytesBase64Encoded: "aW1hZ2U=", mimeType: "image/png" }],
				}),
			),
		})

		const result = await generateImageWithGoogleExpress({
			apiKey: "test-key",
			model: "imagen-4.0-ultra-generate-001",
			prompt: "desk lamp",
		})

		expect(mocks.mockFetch).toHaveBeenCalledWith(
			"https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-ultra-generate-001:predict?key=test-key",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ "Content-Type": "application/json" }),
			}),
		)
		expect(result).toEqual({
			success: true,
			imageData: "data:image/png;base64,aW1hZ2U=",
			imageFormat: "png",
		})
	})

	it("returns Google API error messages", async () => {
		mocks.mockFetch.mockResolvedValue({
			ok: false,
			status: 403,
			statusText: "Forbidden",
			text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: "API key blocked" } })),
		})

		const result = await generateImageWithGoogleExpress({
			apiKey: "bad-key",
			model: "imagen-4.0-ultra-generate-001",
			prompt: "desk lamp",
		})

		expect(result).toEqual({ success: false, error: "API key blocked" })
	})

	it("requires an API key", async () => {
		const result = await generateImageWithGoogleExpress({
			apiKey: "",
			model: "imagen-4.0-ultra-generate-001",
			prompt: "desk lamp",
		})

		expect(mocks.mockFetch).not.toHaveBeenCalled()
		expect(result).toEqual({ success: false, error: "Google Express API key is required for image generation." })
	})
})
