import { describe, expect, it } from "vitest"

import type { SkillMetadata } from "../../../shared/skills"
import { routeSkills } from "../SkillRouter"

const skill = (name: string, description: string, overrides: Partial<SkillMetadata> = {}): SkillMetadata => ({
	name,
	description,
	path: `/skills/${name}/SKILL.md`,
	source: "global",
	...overrides,
})

const skills = [
	skill("pdf-processing", "Extract text and tables from PDF documents"),
	skill("deploy", "Deploy an application to production"),
	skill("code-review", "Review code changes for correctness and security"),
]

describe("routeSkills", () => {
	it("returns no candidate for a greeting", () => {
		expect(routeSkills("hi", skills).candidates).toEqual([])
	})

	it("resolves an explicit skill name", () => {
		const result = routeSkills("use pdf-processing for this file", skills)
		expect(result.explicit).toBe(true)
		expect(result.candidates[0].skill.name).toBe("pdf-processing")
		expect(result.candidates[0].score).toBe(1)
	})

	it("routes a lexical description match", () => {
		const result = routeSkills("extract tables from this PDF document", skills)
		expect(result.candidates[0].skill.name).toBe("pdf-processing")
	})

	it("uses project and mode-specific metadata as deterministic tie breakers", () => {
		const variants = [
			skill("review", "Review code", { source: "global" }),
			skill("review", "Review code", { source: "project", modeSlugs: ["code"] }),
		]
		const result = routeSkills("use review", variants)
		expect(result.candidates[0].skill.source).toBe("project")
	})

	it("bounds candidates", () => {
		const many = Array.from({ length: 10 }, (_, index) => skill(`pdf-${index}`, "Process PDF documents and tables"))
		expect(routeSkills("process pdf documents and tables", many, { maxCandidates: 2 }).candidates).toHaveLength(2)
	})
})
