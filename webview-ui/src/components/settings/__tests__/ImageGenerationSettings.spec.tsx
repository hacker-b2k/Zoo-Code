import { render, fireEvent, waitFor } from "@testing-library/react"

import { ImageGenerationSettings } from "../ImageGenerationSettings"

// Mock vscode API - use vi.hoisted() to define mock before vi.mock is hoisted
const { mockPostMessage } = vi.hoisted(() => ({
	mockPostMessage: vi.fn(),
}))

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: mockPostMessage,
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("ImageGenerationSettings", () => {
	const mockSetImageGenerationProvider = vi.fn()
	const mockSetImageGenerationBaseUrl = vi.fn()
	const mockSetImageGenerationApiKey = vi.fn()
	const mockSetImageGenerationHeaders = vi.fn()
	const mockSetImageGenerationSelectedModel = vi.fn()
	const mockSetImageGenerationApiMethod = vi.fn()
	const mockSetImageGenerationCustomProvider = vi.fn()
	const mockSetVertexImageProjectId = vi.fn()
	const mockSetVertexImageRegion = vi.fn()
	const mockSetVertexImageModel = vi.fn()
	const mockSetVertexImageAuthMode = vi.fn()
	const mockSetVertexImageAccessToken = vi.fn()
	const mockSetVertexImageServiceAccountJson = vi.fn()
	const mockOnChange = vi.fn()

	const defaultProps = {
		enabled: false,
		onChange: mockOnChange,
		imageGenerationProvider: undefined,
		imageGenerationBaseUrl: undefined,
		imageGenerationApiKey: undefined,
		imageGenerationHeaders: undefined,
		imageGenerationSelectedModel: undefined,
		imageGenerationApiMethod: undefined,
		vertexImageProjectId: undefined,
		vertexImageRegion: undefined,
		vertexImageModel: undefined,
		vertexImageAuthMode: undefined,
		vertexImageAccessToken: undefined,
		vertexImageServiceAccountJson: undefined,
		setImageGenerationProvider: mockSetImageGenerationProvider,
		setImageGenerationBaseUrl: mockSetImageGenerationBaseUrl,
		setImageGenerationApiKey: mockSetImageGenerationApiKey,
		setImageGenerationHeaders: mockSetImageGenerationHeaders,
		setImageGenerationSelectedModel: mockSetImageGenerationSelectedModel,
		setImageGenerationApiMethod: mockSetImageGenerationApiMethod,
		setImageGenerationCustomProvider: mockSetImageGenerationCustomProvider,
		setVertexImageProjectId: mockSetVertexImageProjectId,
		setVertexImageRegion: mockSetVertexImageRegion,
		setVertexImageModel: mockSetVertexImageModel,
		setVertexImageAuthMode: mockSetVertexImageAuthMode,
		setVertexImageAccessToken: mockSetVertexImageAccessToken,
		setVertexImageServiceAccountJson: mockSetVertexImageServiceAccountJson,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Initial Mount Behavior", () => {
		it("should not call setter functions on initial mount with empty configuration", () => {
			render(<ImageGenerationSettings {...defaultProps} />)

			expect(mockSetImageGenerationProvider).not.toHaveBeenCalled()
			expect(mockSetImageGenerationBaseUrl).not.toHaveBeenCalled()
			expect(mockSetImageGenerationApiKey).not.toHaveBeenCalled()
			expect(mockSetImageGenerationHeaders).not.toHaveBeenCalled()
			expect(mockSetImageGenerationSelectedModel).not.toHaveBeenCalled()
			expect(mockSetImageGenerationApiMethod).not.toHaveBeenCalled()
		})

		it("should not call setter functions on initial mount with existing configuration", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationApiKey="existing-key"
					imageGenerationSelectedModel="google/gemini-2.5-flash-image"
				/>,
			)

			expect(mockSetImageGenerationProvider).not.toHaveBeenCalled()
			expect(mockSetImageGenerationApiKey).not.toHaveBeenCalled()
			expect(mockSetImageGenerationSelectedModel).not.toHaveBeenCalled()
		})
	})

	describe("User Interaction Behavior", () => {
		it("should call generic image generation API key setter when user changes API key", async () => {
			const { getByPlaceholderText } = render(<ImageGenerationSettings {...defaultProps} enabled={true} />)

			const apiKeyInput = getByPlaceholderText("settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder")
			fireEvent.input(apiKeyInput, { target: { value: "new-api-key" } })

			expect(defaultProps.setImageGenerationApiKey).toHaveBeenCalledWith("new-api-key")
		})

		it("should switch to Vertex AI when selected from provider dropdown", async () => {
			const { container } = render(<ImageGenerationSettings {...defaultProps} enabled={true} />)

			const providerDropdown = container.querySelector("select") as HTMLSelectElement
			fireEvent.change(providerDropdown, { target: { value: "vertex-ai" } })

			expect(defaultProps.setImageGenerationProvider).toHaveBeenCalledWith("vertex-ai")
		})

		it("should switch to Google Express and initialize its default model", async () => {
			const { container } = render(<ImageGenerationSettings {...defaultProps} enabled={true} />)

			const providerDropdown = container.querySelector("select") as HTMLSelectElement
			fireEvent.change(providerDropdown, { target: { value: "google-express" } })

			expect(defaultProps.setImageGenerationProvider).toHaveBeenCalledWith("google-express")
			expect(defaultProps.setImageGenerationSelectedModel).toHaveBeenCalledWith("imagen-4.0-ultra-generate-001")
		})
	})

	describe("Refresh Models Bug Fixes", () => {
		it("should send current base URL (not fallback) when refreshing models", async () => {
			const { getByText } = render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationProvider="openai-compatible"
					imageGenerationBaseUrl="https://custom-api.example.com/v1"
					imageGenerationApiKey="test-key"
				/>,
			)

			// Find and click the Refresh Models button
			const refreshButton = getByText("settings:experimental.IMAGE_GENERATION.refreshModels")
			fireEvent.click(refreshButton)

			// Verify postMessage was called with the custom base URL (not OpenRouter fallback)
			await waitFor(() => {
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "requestImageGenerationModels",
					values: expect.objectContaining({
						baseUrl: "https://custom-api.example.com/v1",
						apiKey: "test-key",
						provider: "openai-compatible",
					}),
				})
			})
		})

		it("should disable refresh button when base URL field is empty", async () => {
			const { getByRole } = render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationProvider="openai-compatible"
					imageGenerationBaseUrl=""
					imageGenerationApiKey="test-key"
				/>,
			)

			// The refresh button should be disabled when base URL is empty
			const refreshButton = getByRole("button", { name: /refreshModels/i })
			expect(refreshButton).toBeDisabled()
		})

		it("should send current API key when refreshing models", async () => {
			const { getByText } = render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationProvider="openai-compatible"
					imageGenerationBaseUrl="https://api.example.com/v1"
					imageGenerationApiKey="my-secret-key-123"
				/>,
			)

			const refreshButton = getByText("settings:experimental.IMAGE_GENERATION.refreshModels")
			fireEvent.click(refreshButton)

			await waitFor(() => {
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "requestImageGenerationModels",
					values: expect.objectContaining({
						apiKey: "my-secret-key-123",
					}),
				})
			})
		})

		it("should clear discovered models when provider changes", async () => {
			const { container } = render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationProvider="openai-compatible"
					imageGenerationBaseUrl="https://api.example.com/v1"
				/>,
			)

			// Change provider
			const providerDropdown = container.querySelector("select") as HTMLSelectElement
			fireEvent.change(providerDropdown, { target: { value: "vertex-ai" } })

			// Verify provider change was triggered
			expect(defaultProps.setImageGenerationProvider).toHaveBeenCalledWith("vertex-ai")
		})

		it("should show loading state when refresh is clicked", async () => {
			const { getByText } = render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationProvider="openai-compatible"
					imageGenerationBaseUrl="https://api.example.com/v1"
					imageGenerationApiKey="test-key"
				/>,
			)

			const refreshButton = getByText("settings:experimental.IMAGE_GENERATION.refreshModels")
			fireEvent.click(refreshButton)

			// Button should be disabled or show loading state
			// (Implementation detail: the button shows a loading spinner)
			await waitFor(() => {
				expect(mockPostMessage).toHaveBeenCalled()
			})
		})
	})

	describe("Conditional Rendering", () => {
		it("should render endpoint input fields when enabled is true", () => {
			const { getByPlaceholderText } = render(<ImageGenerationSettings {...defaultProps} enabled={true} />)

			expect(getByPlaceholderText("settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder")).toBeInTheDocument()
			expect(
				getByPlaceholderText("settings:experimental.IMAGE_GENERATION.manualModelPlaceholder"),
			).toBeInTheDocument()
		})

		it("should not render endpoint input fields when enabled is false", () => {
			const { queryByPlaceholderText } = render(<ImageGenerationSettings {...defaultProps} enabled={false} />)

			expect(
				queryByPlaceholderText("settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder"),
			).not.toBeInTheDocument()
		})
	})

	describe("Professional Provider Workflow", () => {
		it("shows Cloudflare model presets for the Cloudflare custom provider template", () => {
			const { getByText } = render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationProvider="custom"
					imageGenerationBaseUrl="https://api.cloudflare.com/client/v4/accounts/account-id/ai/run"
					imageGenerationApiKey="token"
					imageGenerationSelectedModel="@cf/stabilityai/stable-diffusion-xl-base-1.0"
					imageGenerationApiMethod="direct_post"
					imageGenerationCustomProvider={{
						presetId: "cloudflare-workers-ai",
						directPath: "/{{model}}",
						directBodyTemplate: '{"prompt":"{{prompt}}"}',
					}}
				/>,
			)

			expect(getByText("Stable Diffusion XL Base 1.0")).toBeInTheDocument()
			expect(getByText("FLUX 2 Klein 9B")).toBeInTheDocument()
		})

		it("sends current unsaved settings when Test Provider is clicked", async () => {
			const { getByRole } = render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationProvider="custom"
					imageGenerationBaseUrl="https://api.cloudflare.com/client/v4/accounts/account-id/ai/run"
					imageGenerationApiKey="token"
					imageGenerationSelectedModel="@cf/stabilityai/stable-diffusion-xl-base-1.0"
					imageGenerationApiMethod="direct_post"
					imageGenerationCustomProvider={{
						presetId: "cloudflare-workers-ai",
						directPath: "/{{model}}",
						directBodyTemplate: '{"prompt":"{{prompt}}"}',
					}}
				/>,
			)

			fireEvent.click(getByRole("button", { name: "Test Provider" }))

			await waitFor(() => {
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "testImageGenerationProvider",
					values: expect.objectContaining({
						provider: "custom",
						baseUrl: "https://api.cloudflare.com/client/v4/accounts/account-id/ai/run",
						apiKey: "token",
						model: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
						apiMethod: "direct_post",
					}),
				})
			})
		})
	})
})
