import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../webResearch", () => ({
	searchWeb: vi.fn(),
	readUrl: vi.fn(),
}))

import { readUrl, searchWeb } from "../webResearch"
import { research } from "../webResearchRequest"

describe("research", () => {
	beforeEach(() => vi.clearAllMocks())

	it("routes a direct URL without searching", async () => {
		vi.mocked(readUrl).mockResolvedValue({
			url: "https://example.com",
			title: "Example",
			text: "Body",
			truncated: false,
		})
		const result = await research({ input: "https://example.com" })
		expect(result.kind).toBe("url")
		expect(result.sources[0]).toMatchObject({ title: "Example", url: "https://example.com", content: "Body" })
		expect(searchWeb).not.toHaveBeenCalled()
	})

	it("normalizes search sources and optionally reads top results", async () => {
		vi.mocked(searchWeb).mockResolvedValue({
			query: "test",
			provider: "duckduckgo",
			results: [
				{ title: "A", url: "https://a.test", snippet: "one" },
				{ title: "B", url: "https://b.test", snippet: "two" },
			],
		})
		vi.mocked(readUrl).mockResolvedValue({ url: "https://a.test", title: "A", text: "full", truncated: false })
		const result = await research({ input: "test", readTopSources: 1 })
		expect(result).toMatchObject({ kind: "query", provider: "duckduckgo", query: "test" })
		expect(result.sources[0].content).toBe("full")
		expect(result.sources[1].content).toBeUndefined()
	})

	it("preserves per-source partial fetch errors", async () => {
		vi.mocked(searchWeb).mockResolvedValue({
			query: "test",
			provider: "tavily",
			results: [{ title: "A", url: "https://a.test", snippet: "one" }],
		})
		vi.mocked(readUrl).mockRejectedValue(new Error("network down"))
		const result = await research({ input: "test", readTopSources: 1 })
		expect(result.sources[0].error).toContain("network down")
	})
})
