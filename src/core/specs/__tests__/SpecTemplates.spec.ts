import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { SpecService } from "../SpecService"
import { SpecTemplateService } from "../templates/SpecTemplateService"
import { expandSpecTemplateContent, validateSpecTemplate, type SpecTemplate } from "../templates/templateTypes"

describe("F-015 Spec Templates", () => {
	let globalStorage: string
	let projectRoot: string

	beforeEach(async () => {
		globalStorage = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-template-global-"))
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-template-project-"))
	})

	afterEach(async () => {
		await fs.rm(globalStorage, { recursive: true, force: true })
		await fs.rm(projectRoot, { recursive: true, force: true })
	})

	it("ships the five approved immutable built-in templates", () => {
		const templates = new SpecTemplateService().listTemplates()
		expect(templates.map((template) => template.id)).toEqual([
			"requirements",
			"architecture-design",
			"api-design",
			"adr",
			"implementation-plan",
		])
		expect(templates.every((template) => template.source === "builtin")).toBe(true)
	})

	it("returns clones so callers cannot mutate built-ins", () => {
		const service = new SpecTemplateService()
		const first = service.getTemplate("requirements")!
		first.name = "mutated"
		first.documents[0].content = "mutated"
		const second = service.getTemplate("requirements")!
		expect(second.name).toBe("Requirements")
		expect(second.documents[0].content).toContain("Functional Requirements")
	})

	it("expands only title/date placeholders", () => {
		const expanded = expandSpecTemplateContent("# {{title}}\n{{date}}", {
			title: "Payments API",
			date: "2026-07-24",
		})
		expect(expanded).toBe("# Payments API\n2026-07-24")
		expect(() => expandSpecTemplateContent("{{command}}", { title: "x" })).toThrow(/unknown/i)
	})

	it("rejects unsafe, duplicate, and unknown-placeholder templates", () => {
		const base: SpecTemplate = {
			id: "test",
			name: "Test",
			description: "",
			version: 1,
			source: "user",
			documents: [
				{ id: "design", kind: "design", title: "Design", fileName: "design.md", content: "# {{title}}" },
			],
		}
		expect(() =>
			validateSpecTemplate({ ...base, documents: [{ ...base.documents[0], fileName: "../x.md" }] }),
		).toThrow()
		expect(() =>
			validateSpecTemplate({ ...base, documents: [...base.documents, { ...base.documents[0] }] }),
		).toThrow(/duplicate/i)
		expect(() =>
			validateSpecTemplate({ ...base, documents: [{ ...base.documents[0], content: "{{include}}" }] }),
		).toThrow(/unknown/i)
	})

	it("preserves the existing default createWorkspace behavior", async () => {
		const service = new SpecService(globalStorage)
		const workspace = await service.createWorkspace({ title: "Default", workspaceRoot: projectRoot })
		expect(workspace.docs.map((doc) => doc.kind).sort()).toEqual(["design", "requirements", "tasks"])
	})

	it("creates each template entirely in global storage", async () => {
		const service = new SpecService(globalStorage)
		for (const template of new SpecTemplateService().listTemplates()) {
			const workspace = await service.createWorkspaceFromTemplate({
				workspaceRoot: projectRoot,
				templateId: template.id,
				title: `Pack ${template.id}`,
				date: "2026-07-24",
			})
			expect(workspace.docs).toHaveLength(template.documents.length)
			for (const doc of workspace.docs) {
				const loaded = await service.getDocument(projectRoot, workspace.id, doc.id)
				expect(loaded?.content).toContain(`Pack ${template.id}`)
				expect(loaded?.content).not.toContain("{{")
			}
		}
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("rejects unknown templates without indexing an incomplete workspace", async () => {
		const service = new SpecService(globalStorage)
		await expect(
			service.createWorkspaceFromTemplate({
				workspaceRoot: projectRoot,
				templateId: "missing",
				title: "Missing",
			}),
		).rejects.toThrow(/not found/i)
		expect(await service.listWorkspaces(projectRoot)).toEqual([])
		expect(await fs.readdir(projectRoot)).toEqual([])
	})
})
