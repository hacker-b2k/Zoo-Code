import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@/utils/vscode"

import TaskItem from "../TaskItem"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@/utils/format", () => ({
	formatTimeAgo: vi.fn(() => "2 hours ago"),
	formatDate: vi.fn(() => "January 15 at 2:30 PM"),
	formatLargeNumber: vi.fn((num: number) => num.toString()),
}))

const mockTask = {
	id: "1",
	number: 1,
	task: "Test task",
	ts: Date.now(),
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.002,
	workspace: "/test/workspace",
}

const mockPostMessage = vi.mocked(vscode.postMessage)

describe("TaskItem", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders task information", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		expect(screen.getByText("Test task")).toBeInTheDocument()
		expect(screen.getByText("$0.00")).toBeInTheDocument() // Component shows $0.00 for small amounts
	})

	it("handles selection in selection mode", () => {
		const onToggleSelection = vi.fn()
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={onToggleSelection}
				isSelectionMode={true}
			/>,
		)

		const checkbox = screen.getByRole("checkbox")
		fireEvent.click(checkbox)

		expect(onToggleSelection).toHaveBeenCalledWith("1", true)
	})

	it("shows action buttons", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		// Should show copy and export buttons
		expect(screen.getByTestId("copy-prompt-button")).toBeInTheDocument()
		expect(screen.getByTestId("export")).toBeInTheDocument()
	})

	it("displays time ago information", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		// Should display time ago format
		expect(screen.getByText(/ago/)).toBeInTheDocument()
	})

	it("applies hover effect class", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		const taskItem = screen.getByTestId("task-item-1")
		expect(taskItem).toHaveClass("hover:text-vscode-foreground")
	})

	describe("custom title display", () => {
		it("displays customTitle instead of task text when customTitle is set", () => {
			render(
				<TaskItem
					item={{ ...mockTask, customTitle: "My Custom Title" }}
					variant="full"
					isSelected={false}
					onToggleSelection={vi.fn()}
					isSelectionMode={false}
				/>,
			)

			expect(screen.getByText("My Custom Title")).toBeInTheDocument()
			expect(screen.queryByText("Test task")).not.toBeInTheDocument()
		})

		it("displays task text when customTitle is not set", () => {
			render(
				<TaskItem
					item={mockTask}
					variant="full"
					isSelected={false}
					onToggleSelection={vi.fn()}
					isSelectionMode={false}
				/>,
			)

			expect(screen.getByText("Test task")).toBeInTheDocument()
		})

		it("displays task text when customTitle is empty string", () => {
			render(
				<TaskItem
					item={{ ...mockTask, customTitle: "" }}
					variant="full"
					isSelected={false}
					onToggleSelection={vi.fn()}
					isSelectionMode={false}
				/>,
			)

			expect(screen.getByText("Test task")).toBeInTheDocument()
		})
	})

	describe("rename mode", () => {
		it("shows rename input when renamingTaskId matches item id", () => {
			render(
				<TaskItem
					item={mockTask}
					variant="full"
					isSelected={false}
					onToggleSelection={vi.fn()}
					isSelectionMode={false}
					renamingTaskId="1"
					onStartRename={vi.fn()}
					onFinishRename={vi.fn()}
				/>,
			)

			// The rename input should be visible (value is set by handleStartRename
			// which fires on button click, not when renamingTaskId is set directly)
			expect(screen.getByTestId("task-rename-input")).toBeInTheDocument()
		})

		it("does not show rename input when renamingTaskId does not match", () => {
			render(
				<TaskItem
					item={mockTask}
					variant="full"
					isSelected={false}
					onToggleSelection={vi.fn()}
					isSelectionMode={false}
					renamingTaskId="other-task"
					onStartRename={vi.fn()}
					onFinishRename={vi.fn()}
				/>,
			)

			expect(screen.queryByTestId("task-rename-input")).not.toBeInTheDocument()
		})

		it("shows rename button in footer when onStartRename is provided", () => {
			render(
				<TaskItem
					item={mockTask}
					variant="full"
					isSelected={false}
					onToggleSelection={vi.fn()}
					isSelectionMode={false}
					onStartRename={vi.fn()}
				/>,
			)

			expect(screen.getByTestId("rename-task-button")).toBeInTheDocument()
		})

		it("posts normalized rename text when shared validation passes", () => {
			const onFinishRename = vi.fn()
			render(
				<TaskItem
					item={mockTask}
					variant="full"
					isSelected={false}
					onToggleSelection={vi.fn()}
					isSelectionMode={false}
					renamingTaskId="1"
					onFinishRename={onFinishRename}
				/>,
			)

			const input = screen.getByTestId("task-rename-input")
			fireEvent.change(input, { target: { value: "  Renamed Task  " } })
			fireEvent.blur(input)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "renameTask",
				taskId: "1",
				text: "Renamed Task",
			})
			expect(onFinishRename).toHaveBeenCalled()
		})

		it("does not post rename when shared validation fails in the webview", () => {
			const onFinishRename = vi.fn()
			render(
				<TaskItem
					item={mockTask}
					variant="full"
					isSelected={false}
					onToggleSelection={vi.fn()}
					isSelectionMode={false}
					renamingTaskId="1"
					onFinishRename={onFinishRename}
				/>,
			)

			const input = screen.getByTestId("task-rename-input")
			fireEvent.change(input, { target: { value: "x".repeat(201) } })
			fireEvent.blur(input)

			expect(mockPostMessage).not.toHaveBeenCalled()
			expect(onFinishRename).not.toHaveBeenCalled()
		})
	})
})
