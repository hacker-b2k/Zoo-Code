import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	mockGetAccessToken: vi.fn().mockResolvedValue({ token: "service-account-token" }),
}))

vi.mock("google-auth-library", () => ({
	GoogleAuth: vi.fn().mockImplementation(() => ({
		getClient: vi.fn().mockResolvedValue({
			getAccessToken: mocks.mockGetAccessToken,
		}),
	})),
}))

vi.mock("../../../i18n", () => ({
	t: (key: string, options?: Record<string, unknown>) => options?.message || key,
}))

import { buildVertexImageEndpoint, generateImageWithVertex } from "../utils/vertex-image-generation"

describe("Vertex image generation", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.mockGetAccessToken.mockResolvedValue({ token: "service-account-token" })
		global.fetch = mocks.mockFetch as unknown as typeof fetch
	})

	it("builds the Vertex publisher image endpoint", () => {
		expect(buildVertexImageEndpoint("my-project", "us-central1", "imagen-4.0-generate-001")).toBe(
			"https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/imagen-4.0-generate-001:predict",
		)
	})

	it("uses bearer access-token auth and normalizes a base64 prediction", async () => {
		mocks.mockFetch.mockResolvedValue({
			ok: true,
			text: vi.fn().mockResolvedValue(
				JSON.stringify({
					predictions: [{ bytesBase64Encoded: "aW1hZ2U=", mimeType: "image/png" }],
				}),
			),
		})

		const result = await generateImageWithVertex({
			projectId: "my-project",
			region: "us-central1",
			model: "imagen-4.0-generate-001",
			authMode: "access_token",
			accessToken: "user-token",
			prompt: "mountain lake",
		})

		expect(mocks.mockFetch).toHaveBeenCalledWith(
			"https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/imagen-4.0-generate-001:predict",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ Authorization: "Bearer user-token" }),
			}),
		)
		expect(result).toEqual({
			success: true,
			imageData: "data:image/png;base64,aW1hZ2U=",
			imageFormat: "png",
		})
	})

	it("requires service-account JSON auth when selected", async () => {
		const result = await generateImageWithVertex({
			projectId: "my-project",
			region: "us-central1",
			model: "imagen-4.0-generate-001",
			authMode: "service_account_json",
			prompt: "mountain lake",
		})

		expect(mocks.mockFetch).not.toHaveBeenCalled()
		expect(result).toEqual({
			success: false,
			error: "Valid Vertex AI service account JSON is required for service-account authentication.",
		})
	})

	it("returns Vertex error messages", async () => {
		mocks.mockFetch.mockResolvedValue({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: "invalid auth" } })),
		})

		const result = await generateImageWithVertex({
			projectId: "my-project",
			region: "us-central1",
			model: "imagen-4.0-generate-001",
			authMode: "access_token",
			accessToken: "bad-token",
			prompt: "mountain lake",
		})

		expect(result).toEqual({ success: false, error: "invalid auth" })
	})
})
