import { assertSafeDocFileName, assertSafeId } from "../paths"
import type { SpecDocKind, SpecStage } from "../types"

export type SpecTemplateSource = "builtin" | "user"

export interface SpecTemplateDocument {
	id: string
	kind: SpecDocKind
	title: string
	fileName: string
	content: string
}

export interface SpecTemplate {
	id: string
	name: string
	description: string
	version: 1
	source: SpecTemplateSource
	stage?: SpecStage
	documents: SpecTemplateDocument[]
}

export interface SpecTemplateVariables {
	title: string
	date?: string
}

export interface CreateSpecWorkspaceFromTemplateInput extends SpecTemplateVariables {
	workspaceRoot: string
	templateId: string
}

const PLACEHOLDER = /{{\s*([A-Za-z0-9_-]+)\s*}}/g
const ALLOWED_PLACEHOLDERS = new Set(["title", "date"])

export function validateSpecTemplate(template: SpecTemplate): void {
	assertSafeId(template.id, "templateId")
	if (!template.name.trim()) throw new Error("Template name is required")
	if (template.version !== 1) throw new Error(`Unsupported template version: ${template.version}`)
	if (template.source !== "builtin" && template.source !== "user") throw new Error("Invalid template source")
	if (!Array.isArray(template.documents) || template.documents.length === 0) {
		throw new Error("Template must contain at least one document")
	}
	const ids = new Set<string>()
	const fileNames = new Set<string>()
	for (const doc of template.documents) {
		assertSafeId(doc.id, "template document id")
		assertSafeDocFileName(doc.fileName)
		if (!doc.title.trim()) throw new Error(`Template document title is required: ${doc.id}`)
		if (typeof doc.content !== "string") throw new Error(`Template document content must be a string: ${doc.id}`)
		if (ids.has(doc.id)) throw new Error(`Duplicate template document id: ${doc.id}`)
		const foldedName = doc.fileName.toLowerCase()
		if (fileNames.has(foldedName)) throw new Error(`Duplicate template document fileName: ${doc.fileName}`)
		ids.add(doc.id)
		fileNames.add(foldedName)
		for (const match of doc.content.matchAll(PLACEHOLDER)) {
			if (!ALLOWED_PLACEHOLDERS.has(match[1])) throw new Error(`Unknown template placeholder: ${match[1]}`)
		}
	}
}

export function expandSpecTemplateContent(content: string, variables: SpecTemplateVariables): string {
	const title = variables.title.trim()
	if (!title) throw new Error("title is required")
	const values: Record<string, string> = {
		title,
		date: variables.date ?? new Date().toISOString().slice(0, 10),
	}
	return content.replace(PLACEHOLDER, (_whole, key: string) => {
		if (!ALLOWED_PLACEHOLDERS.has(key)) throw new Error(`Unknown template placeholder: ${key}`)
		return values[key]
	})
}
