import { describe, expect, it } from "vitest"

import { modes } from "../../../shared/modes"
import { detectActionIntent } from "../detectActionIntent"
import { markdownFormattingSection } from "../sections/markdown-formatting"
import { getRulesSection } from "../sections/rules"
import { getSkillsSection } from "../sections/skills"
import { getSharedToolUseSection } from "../sections/tool-use"

const OBSOLETE_PROMPT_PHRASES = [
	/You must call at least one tool per assistant response/i,
	/Default to multi-agent when work can run in parallel/i,
	/For multi-file features, independent modules, research\+implement splits, or any task with 2\+ independent units/i,
	/Never reveal the vendor or company that created you/i,
	/I was created by a team of developers/i,
	/I'm an open-source project maintained by contributors/i,
	/STRICTLY FORBIDDEN from starting your messages with/i,
	/Never provide level of effort time estimates/i,
]

describe("Phase 0 prompt-policy regressions", () => {
	it("classifies a greeting as conversational so it can receive a direct text reply", () => {
		expect(detectActionIntent("hi")).toBeUndefined()
	})

	it("removes the obsolete 5-7 speculative-causes quota from Debug mode", () => {
		const debugMode = modes.find((mode) => mode.slug === "debug")

		expect(debugMode).toBeDefined()
		expect(debugMode?.customInstructions).not.toMatch(/5\s*[-–]\s*7|confirm the diagnosis before fixing/i)
		expect(debugMode?.customInstructions).toContain("evidence-first debugging")
		expect(debugMode?.customInstructions).toContain("If the root cause is already deterministic")
	})

	it("does not inject every available skill for an unrelated request", async () => {
		const skillsManager = {
			getSkillsForMode: () => [
				{ name: "pdf", description: "Process PDF documents", path: "/skills/pdf/SKILL.md" },
				{ name: "deploy", description: "Deploy an application", path: "/skills/deploy/SKILL.md" },
			],
		}

		const section = await getSkillsSection(skillsManager as never, "code", [])

		// A greeting has no relevant candidate; the router should inject no skill
		// inventory rather than asking the model to scan every description.
		expect(section).toBe("")
	})

	it("keeps technical links conditional rather than forcing links into ordinary prose", () => {
		const markdown = markdownFormattingSection()

		expect(markdown).toContain("When a response references a specific file, use a clickable link")
		expect(markdown).toContain("prefer a clickable link with a line number when known")
		expect(markdown).toContain("Plain technical prose does not need artificial links")
		expect(markdown).toContain("do not invent file locations")
		expect(markdown).not.toContain("ALL responses MUST show ANY")
	})

	it("allows natural concise language without banning ordinary openings", () => {
		const rules = getRulesSection("/workspace")

		expect(rules).toContain("Prefer concise, clear language")
		expect(rules).toContain("natural, friendly phrasing is appropriate")
		expect(rules).toContain("must never forbid ordinary greetings, explanation, or natural tone")
		expect(rules).not.toContain('STRICTLY FORBIDDEN from starting your messages with "Great"')
	})

	it("removes universal tool pressure and obsolete prompt conflicts", () => {
		const promptPolicy = [
			getSharedToolUseSection(),
			getRulesSection("/workspace", {
				todoListEnabled: true,
				useAgentRules: true,
				newTaskRequireTodos: false,
				isStealthModel: true,
			}),
			markdownFormattingSection(),
		].join("\n")

		expect(promptPolicy).toContain("Conversational answers and explanations may be returned directly without tools")
		expect(promptPolicy).toContain("When a tool is needed")
		expect(promptPolicy).toContain("independent, non-destructive tools in parallel when that has a clear benefit")
		for (const obsoletePhrase of OBSOLETE_PROMPT_PHRASES) {
			expect(promptPolicy).not.toMatch(obsoletePhrase)
		}
	})

	it("asserts bounded truthful identity section for stealth mode", () => {
		const rules = getRulesSection("/workspace", {
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			isStealthModel: true,
		})

		expect(rules).toContain("IDENTITY")
		expect(rules).toContain("Be accurate and bounded about provenance")
		expect(rules).toContain("Do not falsely claim a different company, project, or model name")
		expect(rules).toContain("state that you don't have vendor details when they are unavailable")
		expect(rules).toContain("Do not volunteer unrelated provenance information")
		expect(rules).not.toContain("Never reveal the vendor or company that created you")
		expect(rules).not.toContain("I was created by a team of developers")
		expect(rules).not.toContain("I'm an open-source project maintained by contributors")
		expect(rules).not.toContain("I don't have information about specific vendors")
	})

	it("excludes identity section when isStealthModel is false", () => {
		const rules = getRulesSection("/workspace", {
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			isStealthModel: false,
		})

		expect(rules).not.toContain("Be accurate and bounded about provenance")
		expect(rules).not.toContain("VENDOR CONFIDENTIALITY")
	})

	it("asserts conditional technical links policy", () => {
		const markdown = markdownFormattingSection()

		// Phase 10: technical links are conditional on file/function references
		expect(markdown).toContain("When a response references a specific file, use a clickable link")
		expect(markdown).toContain("prefer a clickable link with a line number when known")
		expect(markdown).toContain("Plain technical prose does not need artificial links")
		expect(markdown).not.toContain("ALL responses MUST show ANY `language construct` OR filename reference")
	})
})
