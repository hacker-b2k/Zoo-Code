import { BUILTIN_TEMPLATES } from "./builtinTemplates"
import {
	expandSpecTemplateContent,
	validateSpecTemplate,
	type SpecTemplate,
	type SpecTemplateVariables,
} from "./templateTypes"

export class SpecTemplateService {
	listTemplates(): SpecTemplate[] {
		return BUILTIN_TEMPLATES.map((template) => cloneTemplate(template))
	}

	getTemplate(templateId: string): SpecTemplate | null {
		const template = BUILTIN_TEMPLATES.find((candidate) => candidate.id === templateId)
		if (!template) return null
		const cloned = cloneTemplate(template)
		validateSpecTemplate(cloned)
		return cloned
	}

	expandTemplate(templateId: string, variables: SpecTemplateVariables): SpecTemplate {
		const template = this.getTemplate(templateId)
		if (!template) throw new Error(`Spec template not found: ${templateId}`)
		template.documents = template.documents.map((doc) => ({
			...doc,
			content: expandSpecTemplateContent(doc.content, variables),
		}))
		validateSpecTemplate(template)
		return template
	}
}

function cloneTemplate(template: SpecTemplate): SpecTemplate {
	return {
		...template,
		documents: template.documents.map((doc) => ({ ...doc })),
	}
}
