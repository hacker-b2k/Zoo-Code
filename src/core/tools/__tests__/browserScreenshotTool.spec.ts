import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock BrowserEngineManager before importing the tool
vi.mock("../../browser/BrowserEngineManager", () => ({
	BrowserEngineManager: {
		getInstance: vi.fn(),
	},
}))

import { BrowserEngineManager } from "../../browser/BrowserEngineManager"
import { browserScreenshotTool } from "../BrowserTools"

describe("BrowserScreenshotTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should have the correct tool name", () => {
		expect(browserScreenshotTool.name).toBe("browser_screenshot")
	})

	it("should call screenshotPage and return an image data URL", async () => {
		const mockBuffer = Buffer.from("fake-image-data")
		vi.mocked(BrowserEngineManager.getInstance).mockReturnValue({
			screenshotPage: vi.fn().mockResolvedValue({
				mimeType: "image/jpeg",
				data: mockBuffer,
			}),
		} as any)

		const mockTask: any = {
			taskId: "test-task",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn(),
		}

		const pushToolResult = vi.fn()
		const handleError = vi.fn()

		await browserScreenshotTool.execute({ pageId: "test-page" }, mockTask, {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError,
			pushToolResult,
		} as any)

		expect(mockTask.consecutiveMistakeCount).toBe(0)
		expect(pushToolResult).toHaveBeenCalledTimes(1)
		const result = pushToolResult.mock.calls[0][0]
		// The result should contain an image block (Anthropic format)
		expect(Array.isArray(result)).toBe(true)
		const imageBlock = result.find((block: any) => block.type === "image")
		expect(imageBlock).toBeDefined()
		expect(imageBlock.source.type).toBe("base64")
		expect(imageBlock.source.media_type).toBe("image/jpeg")
		expect(imageBlock.source.data).toBe(mockBuffer.toString("base64"))
	})

	it("should pass fullPage option to screenshotPage", async () => {
		const mockBuffer = Buffer.from("fake-image-data")
		const mockScreenshotPage = vi.fn().mockResolvedValue({
			mimeType: "image/jpeg",
			data: mockBuffer,
		})
		vi.mocked(BrowserEngineManager.getInstance).mockReturnValue({
			screenshotPage: mockScreenshotPage,
		} as any)

		const mockTask: any = {
			taskId: "test-task",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn(),
		}

		await browserScreenshotTool.execute({ pageId: "test-page", fullPage: true }, mockTask, {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		} as any)

		expect(mockScreenshotPage).toHaveBeenCalledWith("test-task", "test-page", { fullPage: true })
	})

	it("should report missing pageId parameter", async () => {
		const mockTask: any = {
			taskId: "test-task",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing pageId"),
		}

		const pushToolResult = vi.fn()

		await browserScreenshotTool.execute({ pageId: "" } as any, mockTask, {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult,
		} as any)

		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("browser_screenshot")
		expect(pushToolResult).toHaveBeenCalledWith("Missing pageId")
	})

	it("should handle errors from screenshotPage", async () => {
		vi.mocked(BrowserEngineManager.getInstance).mockReturnValue({
			screenshotPage: vi.fn().mockRejectedValue(new Error("Page not found")),
		} as any)

		const mockTask: any = {
			taskId: "test-task",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn(),
		}

		const handleError = vi.fn()

		await browserScreenshotTool.execute({ pageId: "bad-page" }, mockTask, {
			askApproval: vi.fn(),
			handleError,
			pushToolResult: vi.fn(),
		} as any)

		expect(handleError).toHaveBeenCalledWith("taking browser screenshot", expect.any(Error))
	})
})
