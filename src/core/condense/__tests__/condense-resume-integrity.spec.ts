// npx vitest run core/condense/__tests__/condense-resume-integrity.spec.ts

/**
 * Phase 11: Condense Resume Integrity Tests
 *
 * Verifies that:
 * 1. After condense + resume, effective API history contains summary but not condensed messages
 * 2. After condense + tool call, tool results are preserved in effective history
 * 3. After condense + completion dedupe, summary is not affected
 * 4. getEffectiveApiHistory correctly filters condensed messages
 * 5. cleanupAfterTruncation clears orphaned condenseParent tags
 */

import { getEffectiveApiHistory, cleanupAfterTruncation } from "../index"
import { ApiMessage } from "../../task-persistence/apiMessages"

describe("Phase 11: Condense Resume Integrity", () => {
	describe("getEffectiveApiHistory after condense", () => {
		it("should include summary but exclude condensed messages", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: [{ type: "text", text: "Initial request" }], ts: 100 },
				{
					role: "assistant",
					content: [{ type: "text", text: "Working on it..." }],
					ts: 200,
					condenseParent: "summary-1",
				},
				{
					role: "user",
					content: [{ type: "text", text: "Continue" }],
					ts: 300,
					condenseParent: "summary-1",
				},
				{
					role: "user",
					content: [{ type: "text", text: "## Summary\nDetailed summary of work done" }],
					ts: 400,
					isSummary: true,
					condenseId: "summary-1",
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "Resuming from summary" }],
					ts: 500,
				},
			]

			const effective = getEffectiveApiHistory(messages)

			// getEffectiveApiHistory returns from last summary onwards
			expect(effective.length).toBe(2)
			// Summary content
			const summaryMsg = effective.find((m) => m.isSummary)
			expect(summaryMsg).toBeDefined()
			expect(summaryMsg!.condenseId).toBe("summary-1")
			// Post-summary
			expect(effective[1].content).toEqual([{ type: "text", text: "Resuming from summary" }])

			// Should NOT include condensed messages
			const condensedMsgs = effective.filter((m) => m.condenseParent === "summary-1")
			expect(condensedMsgs.length).toBe(0)
		})

		it("should preserve tool results after condense resume", () => {
			const messages: ApiMessage[] = [
				{
					role: "user",
					content: [{ type: "text", text: "Summary" }],
					ts: 100,
					isSummary: true,
					condenseId: "sum-1",
				},
				{
					role: "assistant",
					content: [
						{ type: "text", text: "I'll read the file" },
						{ type: "tool_use", id: "tu-1", name: "read_file", input: { path: "foo.ts" } },
					],
					ts: 200,
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "tu-1", content: "file contents here" }],
					ts: 300,
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "Done reading file" }],
					ts: 400,
				},
			]

			const effective = getEffectiveApiHistory(messages)

			// All messages should be in effective history (none are condensed)
			expect(effective.length).toBe(4)

			// Tool result should be preserved
			const toolResultMsg = effective.find(
				(m) => Array.isArray(m.content) && m.content.some((c: any) => c.type === "tool_result"),
			)
			expect(toolResultMsg).toBeDefined()
		})

		it("should handle nested condense (summary also condensed by second summary)", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "Start", ts: 100, condenseParent: "sum-1" },
				{
					role: "user",
					content: "First summary",
					ts: 200,
					isSummary: true,
					condenseId: "sum-1",
					condenseParent: "sum-2",
				},
				{ role: "assistant", content: "After first", ts: 300, condenseParent: "sum-2" },
				{
					role: "user",
					content: "Second summary",
					ts: 400,
					isSummary: true,
					condenseId: "sum-2",
				},
				{ role: "assistant", content: "Final response", ts: 500 },
			]

			const effective = getEffectiveApiHistory(messages)

			// Only second summary and final response should be effective
			expect(effective.length).toBe(2)
			expect(effective[0].condenseId).toBe("sum-2")
			expect(effective[1].content).toBe("Final response")
		})
	})

	describe("cleanupAfterTruncation", () => {
		it("should clear orphaned condenseParent tags when summary is removed", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "Msg 1", ts: 100, condenseParent: "orphan-sum" },
				{ role: "assistant", content: "Msg 2", ts: 200, condenseParent: "orphan-sum" },
				{ role: "user", content: "Msg 3", ts: 300 }, // no condenseParent, different condense
			]

			const cleaned = cleanupAfterTruncation(messages)

			// Orphaned tags should be cleared
			expect(cleaned[0].condenseParent).toBeUndefined()
			expect(cleaned[1].condenseParent).toBeUndefined()
		})

		it("should preserve valid condenseParent tags when summary exists", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "Msg 1", ts: 100, condenseParent: "valid-sum" },
				{
					role: "user",
					content: "Summary",
					ts: 200,
					isSummary: true,
					condenseId: "valid-sum",
				},
				{ role: "assistant", content: "After", ts: 300 },
			]

			const cleaned = cleanupAfterTruncation(messages)

			// Valid tag should be preserved
			expect(cleaned[0].condenseParent).toBe("valid-sum")
		})

		it("should clear orphaned truncationParent tags", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "Msg 1", ts: 100, truncationParent: "orphan-trunc" },
				{ role: "assistant", content: "Msg 2", ts: 200 },
			]

			const cleaned = cleanupAfterTruncation(messages)

			expect(cleaned[0].truncationParent).toBeUndefined()
		})
	})

	describe("Condense prompt content verification", () => {
		it("should not inject obsolete policy through summary template", async () => {
			// The CONDENSE prompt template is loaded from support-prompt.ts
			// Verify it doesn't contain any obsolete policy phrases
			const { supportPrompt } = await import("../../../shared/support-prompt")
			const template = supportPrompt.default.CONDENSE

			// These phrases must not reappear through the condense path
			const forbiddenPhrases = [
				/you must call at least one tool/i,
				/STRICTLY FORBIDDEN/i,
				/5[-–]7.*possible.*source/i,
				/VENDOR CONFIDENTIALITY/i,
				/never reveal the vendor/i,
				/I was created by a team/i,
				/Default to multi-agent/i,
				/PRIMARY and PREFERRED tool for ALL browser/i,
				/agent-browser/i,
			]

			for (const phrase of forbiddenPhrases) {
				expect(template).not.toMatch(phrase)
			}
		})

		it("should request actionable workflow state in summary", async () => {
			const { supportPrompt } = await import("../../../shared/support-prompt")
			const template = supportPrompt.default.CONDENSE

			// Should capture actionable state
			expect(template).toContain("Pending Tasks")
			expect(template).toContain("Current Work")
			expect(template).toContain("Optional Next Step")
			expect(template).toContain("Errors and fixes")
		})
	})
})
