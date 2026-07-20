// npx vitest run src/__tests__/history.test.ts

import {
	historyItemSchema,
	getTaskDisplayTitle,
	getTaskSearchText,
	validateTaskCustomTitle,
	CUSTOM_TITLE_MAX_LENGTH,
} from "../history.js"

// ─── Schema tests ─────────────────────────────────────────────────────────────

describe("historyItemSchema", () => {
	it("should parse a HistoryItem with customTitle", () => {
		const raw = {
			id: "task-1",
			number: 1,
			ts: 1000,
			task: "Original task",
			customTitle: "My Custom Title",
			tokensIn: 100,
			tokensOut: 50,
			totalCost: 0.01,
		}
		const result = historyItemSchema.safeParse(raw)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data.customTitle).toBe("My Custom Title")
		}
	})

	it("should parse a HistoryItem without customTitle", () => {
		const raw = {
			id: "task-2",
			number: 1,
			ts: 1000,
			task: "Original task",
			tokensIn: 100,
			tokensOut: 50,
			totalCost: 0.01,
		}
		const result = historyItemSchema.safeParse(raw)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data.customTitle).toBeUndefined()
		}
	})

	it("should reject a HistoryItem with non-string customTitle", () => {
		const raw = {
			id: "task-3",
			number: 1,
			ts: 1000,
			task: "Original task",
			customTitle: 123,
			tokensIn: 100,
			tokensOut: 50,
			totalCost: 0.01,
		}
		const result = historyItemSchema.safeParse(raw)
		expect(result.success).toBe(false)
	})
})

// ─── getTaskDisplayTitle tests ────────────────────────────────────────────────

describe("getTaskDisplayTitle", () => {
	it("should return customTitle when present and non-empty", () => {
		expect(getTaskDisplayTitle({ task: "Original", customTitle: "Custom" })).toBe("Custom")
	})

	it("should return task when customTitle is undefined", () => {
		expect(getTaskDisplayTitle({ task: "Original" })).toBe("Original")
	})

	it("should return task when customTitle is empty string", () => {
		expect(getTaskDisplayTitle({ task: "Original", customTitle: "" })).toBe("Original")
	})

	it("should return task when customTitle is only whitespace", () => {
		expect(getTaskDisplayTitle({ task: "Original", customTitle: "   " })).toBe("Original")
	})

	it("should trim customTitle before checking emptiness", () => {
		// getTaskDisplayTitle calls .trim() so leading/trailing whitespace is stripped
		expect(getTaskDisplayTitle({ task: "Original", customTitle: "  Custom  " })).toBe("Custom")
	})

	it("should return customTitle even if it matches task (edge case)", () => {
		// The display function doesn't validate — that's the validator's job
		expect(getTaskDisplayTitle({ task: "Same", customTitle: "Same" })).toBe("Same")
	})
})

// ─── getTaskSearchText tests ──────────────────────────────────────────────────

describe("getTaskSearchText", () => {
	it("should return task only when customTitle is undefined", () => {
		expect(getTaskSearchText({ task: "Original" })).toBe("Original")
	})

	it("should return task only when customTitle is empty string", () => {
		expect(getTaskSearchText({ task: "Original", customTitle: "" })).toBe("Original")
	})

	it("should return task only when customTitle is only whitespace", () => {
		expect(getTaskSearchText({ task: "Original", customTitle: "   " })).toBe("Original")
	})

	it("should return customTitle + newline + task when customTitle is present", () => {
		expect(getTaskSearchText({ task: "Original", customTitle: "Custom" })).toBe("Custom\nOriginal")
	})

	it("should include both fields so searches match either", () => {
		const text = getTaskSearchText({ task: "Fix login bug", customTitle: "Auth Fix" })
		expect(text).toContain("Auth Fix")
		expect(text).toContain("Fix login bug")
	})
})

// ─── validateTaskCustomTitle tests ────────────────────────────────────────────

describe("validateTaskCustomTitle", () => {
	it("should accept empty string (clear title)", () => {
		const result = validateTaskCustomTitle("", "Original task")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.normalized).toBe("")
		}
	})

	it("should accept whitespace-only string (clear title)", () => {
		const result = validateTaskCustomTitle("   ", "Original task")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.normalized).toBe("")
		}
	})

	it("should accept a valid custom title", () => {
		const result = validateTaskCustomTitle("My Custom Title", "Original task")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.normalized).toBe("My Custom Title")
		}
	})

	it("should trim the proposed title", () => {
		const result = validateTaskCustomTitle("  Trimmed Title  ", "Original task")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.normalized).toBe("Trimmed Title")
		}
	})

	it("should reject titles exceeding max length", () => {
		const longTitle = "a".repeat(CUSTOM_TITLE_MAX_LENGTH + 1)
		const result = validateTaskCustomTitle(longTitle, "Original task")
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error).toContain(`${CUSTOM_TITLE_MAX_LENGTH}`)
		}
	})

	it("should accept a title exactly at max length", () => {
		const maxTitle = "a".repeat(CUSTOM_TITLE_MAX_LENGTH)
		const result = validateTaskCustomTitle(maxTitle, "Original task")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.normalized).toBe(maxTitle)
		}
	})

	it("should normalize to empty when proposed title matches original task", () => {
		const result = validateTaskCustomTitle("Original task", "Original task")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.normalized).toBe("")
		}
	})

	it("should normalize to empty when trimmed title matches trimmed task", () => {
		const result = validateTaskCustomTitle("  Original task  ", "  Original task  ")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.normalized).toBe("")
		}
	})

	it("should accept a title that differs from task only in case", () => {
		const result = validateTaskCustomTitle("original task", "Original task")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.normalized).toBe("original task")
		}
	})
})

// ─── CUSTOM_TITLE_MAX_LENGTH constant ─────────────────────────────────────────

describe("CUSTOM_TITLE_MAX_LENGTH", () => {
	it("should be defined and positive", () => {
		expect(CUSTOM_TITLE_MAX_LENGTH).toBeGreaterThan(0)
	})

	it("should be 200", () => {
		expect(CUSTOM_TITLE_MAX_LENGTH).toBe(200)
	})
})
