import { describe, it, expect, beforeEach, vi } from "vitest"
import { webviewMessageHandler } from "../webviewMessageHandler"
import { CUSTOM_TITLE_MAX_LENGTH } from "@roo-code/types"

// Mock the saveTaskMessages function
vi.mock("../../task-persistence", () => ({
	saveTaskMessages: vi.fn(),
}))

// Mock the i18n module
vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
	changeLanguage: vi.fn(),
}))

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
	workspace: {
		workspaceFolders: undefined,
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
			update: vi.fn(),
		})),
	},
	ConfigurationTarget: {
		Global: 1,
		Workspace: 2,
		WorkspaceFolder: 3,
	},
	Uri: {
		parse: vi.fn((str) => ({ toString: () => str })),
		file: vi.fn((path) => ({ fsPath: path })),
	},
	env: {
		openExternal: vi.fn(),
		clipboard: {
			writeText: vi.fn(),
		},
	},
	commands: {
		executeCommand: vi.fn(),
	},
}))

describe("webviewMessageHandler renameTask", () => {
	let provider: any
	const existingHistoryItem = {
		id: "task-123",
		task: "Fix the authentication bug in the login flow",
		ts: Date.now(),
		workspace: "/test/workspace",
	}

	beforeEach(() => {
		vi.clearAllMocks()

		provider = {
			getCurrentTask: vi.fn(() => undefined),
			postMessageToWebview: vi.fn(async () => {}),
			getTaskHistoryItem: vi.fn((id: string) => {
				if (id === existingHistoryItem.id) {
					return existingHistoryItem
				}
				return undefined
			}),
			renameTask: vi.fn(async () => {}),
			contextProxy: {
				getValue: vi.fn(),
				setValue: vi.fn(async () => {}),
				globalStorageUri: { fsPath: "/test/path" },
			},
			log: vi.fn(),
			cwd: "/test/cwd",
		}
	})

	it("should call provider.renameTask with normalized title when validation passes", async () => {
		await webviewMessageHandler(provider, {
			type: "renameTask",
			taskId: "task-123",
			text: "Auth Bug Fix",
		})

		expect(provider.getTaskHistoryItem).toHaveBeenCalledWith("task-123")
		expect(provider.renameTask).toHaveBeenCalledWith("task-123", "Auth Bug Fix")
		expect(provider.postMessageToWebview).not.toHaveBeenCalled()
	})

	it("should trim whitespace from proposed title before validation", async () => {
		await webviewMessageHandler(provider, {
			type: "renameTask",
			taskId: "task-123",
			text: "  Auth Bug Fix  ",
		})

		expect(provider.renameTask).toHaveBeenCalledWith("task-123", "Auth Bug Fix")
	})

	it("should clear custom title when empty string is proposed", async () => {
		await webviewMessageHandler(provider, {
			type: "renameTask",
			taskId: "task-123",
			text: "",
		})

		// Empty string normalizes to "" — renameTask should be called with ""
		expect(provider.renameTask).toHaveBeenCalledWith("task-123", "")
	})

	it("should clear custom title when text is undefined", async () => {
		await webviewMessageHandler(provider, {
			type: "renameTask",
			taskId: "task-123",
		})

		// undefined text defaults to "" — renameTask should be called with ""
		expect(provider.renameTask).toHaveBeenCalledWith("task-123", "")
	})

	it("should clear custom title when proposed title is whitespace only", async () => {
		await webviewMessageHandler(provider, {
			type: "renameTask",
			taskId: "task-123",
			text: "   ",
		})

		expect(provider.renameTask).toHaveBeenCalledWith("task-123", "")
	})

	it("should log validation error and NOT call renameTask when title exceeds max length", async () => {
		const longTitle = "A".repeat(CUSTOM_TITLE_MAX_LENGTH + 1)

		await webviewMessageHandler(provider, {
			type: "renameTask",
			taskId: "task-123",
			text: longTitle,
		})

		expect(provider.log).toHaveBeenCalledWith(expect.stringContaining(`${CUSTOM_TITLE_MAX_LENGTH}`))
		expect(provider.renameTask).not.toHaveBeenCalled()
	})

	it("should clear custom title when proposed title matches the original task text", async () => {
		await webviewMessageHandler(provider, {
			type: "renameTask",
			taskId: "task-123",
			text: existingHistoryItem.task,
		})

		// Same as original task normalizes to "" — renameTask should be called with ""
		expect(provider.renameTask).toHaveBeenCalledWith("task-123", "")
	})

	it("should clear custom title when proposed title matches original task with whitespace", async () => {
		await webviewMessageHandler(provider, {
			type: "renameTask",
			taskId: "task-123",
			text: `  ${existingHistoryItem.task}  `,
		})

		// After trim, it equals original task — normalize to ""
		expect(provider.renameTask).toHaveBeenCalledWith("task-123", "")
	})

	it("should NOT call renameTask when taskId is missing", async () => {
		await webviewMessageHandler(provider, {
			type: "renameTask",
			text: "New Title",
		})

		expect(provider.getTaskHistoryItem).not.toHaveBeenCalled()
		expect(provider.renameTask).not.toHaveBeenCalled()
		expect(provider.postMessageToWebview).not.toHaveBeenCalled()
	})

	it("should NOT call renameTask when task history item does not exist", async () => {
		await webviewMessageHandler(provider, {
			type: "renameTask",
			taskId: "non-existent-id",
			text: "New Title",
		})

		expect(provider.getTaskHistoryItem).toHaveBeenCalledWith("non-existent-id")
		expect(provider.renameTask).not.toHaveBeenCalled()
		expect(provider.postMessageToWebview).not.toHaveBeenCalled()
	})

	it("should treat case-different titles as distinct (not equal to original task)", async () => {
		// The original task starts with "Fix" — using "fix" should NOT be treated as same
		await webviewMessageHandler(provider, {
			type: "renameTask",
			taskId: "task-123",
			text: "fix the authentication bug in the login flow",
		})

		// Different case from original — should be accepted as a valid custom title
		expect(provider.renameTask).toHaveBeenCalledWith("task-123", "fix the authentication bug in the login flow")
	})

	it("should accept a title at exactly the max length boundary", async () => {
		const boundaryTitle = "A".repeat(CUSTOM_TITLE_MAX_LENGTH)

		await webviewMessageHandler(provider, {
			type: "renameTask",
			taskId: "task-123",
			text: boundaryTitle,
		})

		expect(provider.renameTask).toHaveBeenCalledWith("task-123", boundaryTitle)
	})
})
