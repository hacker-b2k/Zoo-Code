import { render } from "ink-testing-library"

import { createHistoryTrigger, toHistoryResult, type HistoryResult } from "../HistoryTrigger.js"

const mockHistoryItems: HistoryResult[] = [
	{
		key: "task-1",
		id: "task-1",
		task: "Fix the login bug in the auth module",
		ts: Date.now() - 1000 * 60 * 30, // 30 minutes ago
		mode: "code",
		status: "completed",
		workspace: "/projects/my-app",
	},
	{
		key: "task-2",
		id: "task-2",
		task: "Add unit tests for the user service",
		ts: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
		mode: "test",
		status: "active",
		workspace: "/projects/my-app",
	},
	{
		key: "task-3",
		id: "task-3",
		task: "Refactor the database queries for better performance",
		ts: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
		mode: "architect",
		status: "delegated",
		workspace: "/projects/other-app",
	},
	{
		key: "task-4",
		id: "task-4",
		task: "Fix authentication flow",
		customTitle: "Auth Overhaul",
		ts: Date.now() - 1000 * 60 * 60 * 4, // 4 hours ago
		mode: "code",
		status: "completed",
		workspace: "/projects/my-app",
	},
]

describe("HistoryTrigger", () => {
	describe("createHistoryTrigger", () => {
		it("should detect # trigger at line start", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const result = trigger.detectTrigger("#")
			expect(result).toEqual({ query: "", triggerIndex: 0 })
		})

		it("should detect # trigger with query", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const result = trigger.detectTrigger("#login")
			expect(result).toEqual({ query: "login", triggerIndex: 0 })
		})

		it("should detect # trigger after whitespace", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const result = trigger.detectTrigger("  #")
			expect(result).toEqual({ query: "", triggerIndex: 2 })
		})

		it("should detect # trigger with query after whitespace", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const result = trigger.detectTrigger("  #fix")
			expect(result).toEqual({ query: "fix", triggerIndex: 2 })
		})

		it("should not detect # in middle of text", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			// The trigger position is "line-start", so it should only match at start
			const result = trigger.detectTrigger("some text #")
			expect(result).toBeNull()
		})

		it("should return all history items when query is empty, sorted by timestamp", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const results = trigger.search("") as HistoryResult[]

			// Should return all 4 items
			expect(results.length).toBe(4)
			// Should be sorted by timestamp (newest first)
			expect(results[0]?.id).toBe("task-1") // 30 mins ago
			expect(results[1]?.id).toBe("task-2") // 2 hours ago
			expect(results[2]?.id).toBe("task-4") // 4 hours ago
			expect(results[3]?.id).toBe("task-3") // 1 day ago
		})

		it("should filter history items by fuzzy search on task", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const results = trigger.search("login") as HistoryResult[]
			expect(results.length).toBe(1)
			expect(results[0]?.id).toBe("task-1")
			expect(results[0]?.task).toContain("login")
		})

		it("should handle partial matching", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			// Fuzzy search for "unit" matches task-2 via the shared getTaskSearchText resolver.
			const results = trigger.search("unit") as HistoryResult[]
			const ids = results.map((r) => r.id)
			expect(ids).toContain("task-2")
			expect(results.length).toBeGreaterThanOrEqual(1)
		})

		it("should return empty array for non-matching query", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const results = trigger.search("xyznonexistent") as HistoryResult[]
			expect(results.length).toBe(0)
		})

		it("should respect maxResults limit", () => {
			const manyItems: HistoryResult[] = Array.from({ length: 20 }, (_, i) => ({
				key: `task-${i}`,
				id: `task-${i}`,
				task: `Task number ${i}`,
				ts: Date.now() - i * 1000 * 60,
				mode: "code",
			}))

			const trigger = createHistoryTrigger({
				getHistory: () => manyItems,
				maxResults: 5,
			})

			const results = trigger.search("") as HistoryResult[]
			expect(results.length).toBe(5)
		})

		it("should use default maxResults of 15", () => {
			const manyItems: HistoryResult[] = Array.from({ length: 20 }, (_, i) => ({
				key: `task-${i}`,
				id: `task-${i}`,
				task: `Task number ${i}`,
				ts: Date.now() - i * 1000 * 60,
				mode: "code",
			}))

			const trigger = createHistoryTrigger({
				getHistory: () => manyItems,
			})

			const results = trigger.search("") as HistoryResult[]
			expect(results.length).toBe(15)
		})

		it("should return empty string for replacement text", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const item = mockHistoryItems[0]!
			const replacement = trigger.getReplacementText(item, "#login", 0)
			expect(replacement).toBe("")
		})

		it("should render history items correctly", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const item = mockHistoryItems[0]!
			const { lastFrame } = render(trigger.renderItem(item, false) as React.ReactElement)

			const output = lastFrame()
			// Should contain the task (possibly truncated)
			expect(output).toContain("login")
			// Should contain mode indicator
			expect(output).toContain("[code]")
			// Should contain status indicator (✓ for completed)
			expect(output).toContain("✓")
		})

		it("should render active status with correct indicator", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const activeItem = mockHistoryItems[1]! // status: "active"
			const { lastFrame } = render(trigger.renderItem(activeItem, false) as React.ReactElement)

			const output = lastFrame()
			// Should contain the active status indicator (●)
			expect(output).toContain("●")
		})

		it("should render delegated status with correct indicator", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const delegatedItem = mockHistoryItems.find((i) => i.status === "delegated")!
			const { lastFrame } = render(trigger.renderItem(delegatedItem, false) as React.ReactElement)

			const output = lastFrame()
			// Should contain the delegated status indicator (○)
			expect(output).toContain("○")
		})

		it("should render selected items with different styling", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const item = mockHistoryItems[0]!
			const { lastFrame: unselectedFrame } = render(trigger.renderItem(item, false) as React.ReactElement)
			const { lastFrame: selectedFrame } = render(trigger.renderItem(item, true) as React.ReactElement)

			// Both should contain the task content
			expect(unselectedFrame()).toContain("login")
			expect(selectedFrame()).toContain("login")
		})

		it("should have correct trigger configuration", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			expect(trigger.id).toBe("history")
			expect(trigger.triggerChar).toBe("#")
			expect(trigger.position).toBe("line-start")
			expect(trigger.emptyMessage).toBe("No task history found")
			expect(trigger.debounceMs).toBe(100)
		})

		it("should not have consumeTrigger set (# character appears in input)", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			// The # character should remain in the input like other triggers
			expect(trigger.consumeTrigger).toBeUndefined()
		})

		it("should call getHistory when searching", () => {
			const getHistoryMock = vi.fn(() => mockHistoryItems)
			const trigger = createHistoryTrigger({ getHistory: getHistoryMock })

			trigger.search("")
			expect(getHistoryMock).toHaveBeenCalled()

			trigger.search("test")
			expect(getHistoryMock).toHaveBeenCalledTimes(2)
		})
	})

	describe("toHistoryResult", () => {
		it("should convert history item to HistoryResult", () => {
			const item = {
				id: "test-task-1",
				task: "Test task description",
				ts: 1704067200000,
				totalCost: 0.05,
				workspace: "/projects/test",
				mode: "code",
				status: "completed" as const,
			}

			const result = toHistoryResult(item)

			expect(result.key).toBe("test-task-1") // key should be the task ID
			expect(result.id).toBe("test-task-1")
			expect(result.task).toBe("Test task description")
			expect(result.ts).toBe(1704067200000)
			expect(result.totalCost).toBe(0.05)
			expect(result.workspace).toBe("/projects/test")
			expect(result.mode).toBe("code")
			expect(result.status).toBe("completed")
		})

		it("should handle optional fields", () => {
			const minimalItem = {
				id: "minimal-task",
				task: "Minimal task",
				ts: 1704067200000,
			}

			const result = toHistoryResult(minimalItem)

			expect(result.key).toBe("minimal-task")
			expect(result.id).toBe("minimal-task")
			expect(result.task).toBe("Minimal task")
			expect(result.ts).toBe(1704067200000)
			expect(result.totalCost).toBeUndefined()
			expect(result.workspace).toBeUndefined()
			expect(result.mode).toBeUndefined()
			expect(result.status).toBeUndefined()
			expect(result.customTitle).toBeUndefined()
		})

		it("should preserve customTitle when converting", () => {
			const item = {
				id: "custom-task",
				task: "Original task description",
				customTitle: "My Custom Title",
				ts: 1704067200000,
			}

			const result = toHistoryResult(item)

			expect(result.customTitle).toBe("My Custom Title")
			expect(result.task).toBe("Original task description")
		})
	})

	describe("custom title search and display", () => {
		it("should find tasks by customTitle in fuzzy search", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			// "Auth Overhaul" is the customTitle of task-4
			const results = trigger.search("Auth Overhaul") as HistoryResult[]
			const ids = results.map((r) => r.id)
			expect(ids).toContain("task-4")
		})

		it("should find tasks by original task text even when customTitle is set", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			// "authentication" appears in task-4's original task text
			const results = trigger.search("authentication flow") as HistoryResult[]
			const ids = results.map((r) => r.id)
			expect(ids).toContain("task-4")
		})

		it("should render display title (customTitle) for items with customTitle", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const itemWithCustomTitle = mockHistoryItems.find((i) => i.id === "task-4")!
			const { lastFrame } = render(trigger.renderItem(itemWithCustomTitle, false) as React.ReactElement)

			const output = lastFrame()
			// Should show customTitle "Auth Overhaul", not the original task text
			expect(output).toContain("Auth Overhaul")
		})

		it("should render original task text for items without customTitle", () => {
			const trigger = createHistoryTrigger({ getHistory: () => mockHistoryItems })

			const itemWithoutCustomTitle = mockHistoryItems.find((i) => i.id === "task-1")!
			const { lastFrame } = render(trigger.renderItem(itemWithoutCustomTitle, false) as React.ReactElement)

			const output = lastFrame()
			expect(output).toContain("login")
		})
	})
})
