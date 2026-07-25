import { describe, it, expect } from "vitest"

import { buildSpecWorkspaceHtml } from "../specWorkspaceHtml"

function getInlineWorkspaceScript(html: string): string {
	const scripts = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)]
	const script = scripts.at(-1)?.[1]
	if (!script) throw new Error("Spec Workspace inline script was not found")
	return script
}

describe("buildSpecWorkspaceHtml", () => {
	it("embeds nonce and csp source", () => {
		const html = buildSpecWorkspaceHtml("abc123", "vscode-webview:")
		expect(html).toContain("nonce-abc123")
		expect(html).toContain("vscode-webview:")
		expect(html).toContain("Spec Workspace")
		expect(html).toContain("acquireVsCodeApi")
	})

	it("emits a syntactically valid inline script so initialization can complete", () => {
		const html = buildSpecWorkspaceHtml("parse-check", "vscode-webview:")
		const script = getInlineWorkspaceScript(html)
		try {
			new Function(`${script}\n//# sourceURL=spec-workspace-inline.js`)
		} catch (error) {
			throw new Error(
				`Spec Workspace inline script does not parse: ${error instanceof Error ? error.stack : String(error)}`,
			)
		}
	})

	it("includes F-020 agent stream message handlers (preview only)", () => {
		const html = buildSpecWorkspaceHtml("n1", "csp")
		expect(html).toContain("agentWriteStarted")
		expect(html).toContain("agentWritePartial")
		expect(html).toContain("agentWriteFinalized")
		expect(html).toContain("agentWriteAborted")
		expect(html).toContain("agentStreaming")
		expect(html).toContain("preview only, not saved yet")
	})

	it("includes F-020b append protocol + rAF coalesce helpers", () => {
		const html = buildSpecWorkspaceHtml("n2", "csp")
		expect(html).toContain("queueAgentPartial")
		expect(html).toContain("applyAgentPartial")
		expect(html).toContain("fullResync")
		expect(html).toContain("baseLen")
		expect(html).toContain("msg.append")
		expect(html).toContain("streamPinnedAtBottom")
		expect(html).toContain("requestAnimationFrame")
	})

	it("F-008: embeds preview + mermaid script tags when URIs provided", () => {
		const html = buildSpecWorkspaceHtml(
			"n3",
			"vscode-webview:",
			"vscode-webview:/spec-preview.js",
			"vscode-webview:/mermaid.min.js",
		)
		expect(html).toContain('src="vscode-webview:/spec-preview.js"')
		expect(html).toContain('src="vscode-webview:/mermaid.min.js"')
		expect(html).toContain("nonce-n3")
	})

	it("F-008: omits script tags when URIs not provided (graceful degradation)", () => {
		const html = buildSpecWorkspaceHtml("n4", "vscode-webview:")
		expect(html).not.toContain("spec-preview.js")
		expect(html).not.toContain("mermaid.min.js")
	})

	it("F-008: includes split pane structure + view toggle", () => {
		const html = buildSpecWorkspaceHtml("n5", "vscode-webview:")
		expect(html).toContain("pane-grid")
		expect(html).toContain("editor-pane")
		expect(html).toContain("preview-pane")
		expect(html).toContain('id="preview"')
		expect(html).toContain('id="previewOverlay"')
		expect(html).toContain('id="btnViewEdit"')
		expect(html).toContain('id="btnViewSplit"')
		expect(html).toContain('id="btnViewPreview"')
	})

	it("F-008: includes preview render functions and CSP allows unsafe-eval for mermaid", () => {
		const html = buildSpecWorkspaceHtml("n6", "vscode-webview:")
		expect(html).toContain("renderPreviewMarkdown")
		expect(html).toContain("renderPreviewMermaid")
		expect(html).toContain("schedulePreviewRender")
		expect(html).toContain("setViewMode")
		expect(html).toContain("__specPreview")
		// Mermaid requires 'unsafe-eval' in the CSP script-src
		expect(html).toContain("'unsafe-eval'")
	})

	it("F-024: provides themed selection actions and posts a validated handoff payload", () => {
		const html = buildSpecWorkspaceHtml("n7", "vscode-webview:")
		expect(html).toContain('id="selectionActionBubble"')
		expect(html).toContain('id="selectionActionPopup"')
		expect(html).toContain('data-selection-action="rewrite"')
		expect(html).toContain('data-selection-action="improve"')
		expect(html).toContain('data-selection-action="remove"')
		expect(html).toContain('data-selection-action="custom"')
		expect(html).toContain('type: "aiSelectionAction"')
		expect(html).toContain("mappingConfidence")
		expect(html).toContain("MAX_SELECTION_CHARS")
	})

	it("F-024: debounces, suppresses, and hides selection actions on workspace changes", () => {
		const html = buildSpecWorkspaceHtml("n8", "vscode-webview:")
		expect(html).toContain("}, 135)")
		expect(html).toContain("if (agentStreaming) return hideSelectionActions()")
		expect(html).toContain('event.key === "Escape"')
		expect(html).toContain('editor.addEventListener("scroll", hideSelectionActions)')
		expect(html).toContain("hideSelectionActions();\n      agentStreaming = !!on")
		expect(html).toContain("hideSelectionActions();\n      if (agentStreaming) {")
	})

	it("F-024b: derives no selection context in the webview — the host is authoritative", () => {
		const html = buildSpecWorkspaceHtml("n9", "vscode-webview:")
		// Location context is resolved host-side from the current document content
		// (resolveSelectionContext). Deriving it here too would create a parallel
		// implementation whose output is discarded and which drifts from the one used.
		for (const removed of [
			"buildSelectionContext",
			"buildHeadingPath",
			"detectBlockType",
			"detectTaskContext",
			"detectListContext",
			"detectTableContext",
			"detectMermaid",
			"detectRequirementContext",
			"buildSurroundingContext",
			"buildDocumentMap",
			"invalidateDocumentMap",
			"computeConfidence",
			"stableHash",
			"quickHash",
			"documentMapSummary",
		]) {
			expect(html).not.toContain(removed)
		}
	})

	it("F-024b: an unmapped preview selection sends no fabricated location", () => {
		const html = buildSpecWorkspaceHtml("n10", "vscode-webview:")
		// Preview text that cannot be found in source must omit its location rather
		// than claiming offset 0 / line 1, which would anchor the host's nearest-match
		// disambiguation to the top of the document.
		expect(html).toContain("const mapped = start !== undefined")
		expect(html).toContain("startOffset: mapped ? start : undefined")
		expect(html).toContain("startLine: mapped ? lineAt(editor.value, start) : undefined")
		expect(html).not.toContain("const resolvedStart = start !== undefined ? start : 0")
	})

	it("F-024b: the handoff payload carries the selection and its location hint only", () => {
		const html = buildSpecWorkspaceHtml("n11", "vscode-webview:")
		const script = getInlineWorkspaceScript(html)
		const payload = script.slice(
			script.indexOf('vscode.postMessage({ type: "aiSelectionAction"'),
			script.indexOf("hideSelectionActions();\n    });"),
		)
		expect(payload).toContain("selectedText: selectionSnapshot.selectedText")
		expect(payload).toContain("startOffset: selectionSnapshot.startOffset")
		expect(payload).toContain("startLine: selectionSnapshot.startLine")
		expect(payload).toContain("mappingConfidence: selectionSnapshot.mappingConfidence")
		expect(payload).toContain("revision: currentRevision")
		// Derived facts are the host's job and must not be re-sent from here.
		for (const derived of ["headingPath", "blockType", "tableColumn", "surroundingBefore", "confidence"]) {
			expect(payload).not.toContain(derived)
		}
	})
})
