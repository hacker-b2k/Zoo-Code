import * as vscode from "vscode"

import { SpecService } from "../SpecService"
import { hashWorkspaceRoot } from "../paths"
import { SpecImportCoordinator } from "../import/SpecImportCoordinator"
import { SpecExportCoordinator } from "../export/SpecExportCoordinator"
import type { SpecExportConflictAction } from "../export/exportTypes"
import { SpecPackageCoordinator } from "../package/SpecPackageCoordinator"
import { getNonce } from "../../webview/getNonce"
import { buildSpecWorkspaceHtml } from "./specWorkspaceHtml"
import { buildSpecDocumentUri } from "../virtualDocs/specUri"
import { clearLastOpened, loadLastOpened, saveLastOpened } from "./specUiState"
import { invalidateSpecContextCache } from "../specContext"
import { type SelectionContextAction, selectionContextStore } from "../selection/SelectionContextStore"
import { resolveSelectionContext } from "../selection/resolveSelectionContext"
import { resolveVisibleClineProvider } from "./clineProviderAccessor"

export interface SpecWorkspacePanelDeps {
	context: vscode.ExtensionContext
	/** Absolute path to extension global storage (or custom storage base). */
	globalStoragePath: string
	/** Current project workspace root (cwd). */
	getWorkspaceRoot: () => string
	outputChannel?: vscode.OutputChannel
}

type WebviewToHostMessage =
	| { type: "ready" }
	| { type: "refresh" }
	| { type: "createSpec"; title: string }
	| { type: "importPlans" }
	| { type: "exportSpec" }
	| { type: "deleteSpec"; specId: string }
	| { type: "openDocument"; specId: string; docKind: string }
	| { type: "openInEditor"; specId: string; docKind: string }
	| { type: "saveDocument"; specId: string; docKind: string; content: string }
	/**
	 * F-024/F-024b: a selection handoff from the webview.
	 *
	 * This carries only what the webview alone can know: which document the user was
	 * looking at, the literal text they selected, and — when it is genuinely known —
	 * where that text sits in the editor buffer. Every derived location fact is
	 * computed host-side by `resolveSelectionContext` against the current document,
	 * so the two never disagree.
	 *
	 * The location fields are deliberately optional: a preview selection that cannot
	 * be mapped back to source omits them rather than inventing line 1 / offset 0.
	 */
	| {
			type: "aiSelectionAction"
			action: SelectionContextAction
			specId: string
			docKind: string
			selectedText: string
			source: "editor" | "preview"
			/** Location hint; absent when the selection could not be mapped to source. */
			startOffset?: number
			endOffset?: number
			startLine?: number
			endLine?: number
			mappingConfidence: "exact" | "approximate" | "unmapped"
			revision?: number
			docOrder?: number
			docLabel?: string
	  }

/** F-020 / F-020b: agent write_spec streaming events (host → webview). */
export interface AgentWriteStreamPayload {
	streamId: string
	specId?: string | null
	title?: string | null
	docKind: string
	mode: "create" | "update"
	/** Full body resync (first paint, mismatch recovery, or non-prefix growth). */
	content?: string
	/** F-020b: suffix only when content grew as a pure append. */
	append?: string
	/** F-020b: expected editor length before applying append. */
	baseLen?: number
	/** When true, webview must replace entire editor value from content. */
	fullResync?: boolean
	contentLength?: number
	revision?: number
	entries?: unknown[]
	reason?: string
}

/**
 * Minimal Spec Workspace webview panel (F-002) + agent live stream (F-020).
 * Uses SpecService only — never writes into the project tree.
 */
export class SpecWorkspacePanel {
	public static readonly viewType = "zoo-code.SpecWorkspace"

	private static current: SpecWorkspacePanel | undefined

	private readonly panel: vscode.WebviewPanel
	private readonly service: SpecService
	private readonly getWorkspaceRoot: () => string
	private readonly context: vscode.ExtensionContext
	private readonly outputChannel?: vscode.OutputChannel
	private disposables: vscode.Disposable[] = []

	private constructor(panel: vscode.WebviewPanel, deps: SpecWorkspacePanelDeps) {
		this.panel = panel
		this.context = deps.context
		this.getWorkspaceRoot = deps.getWorkspaceRoot
		this.outputChannel = deps.outputChannel
		this.service = new SpecService(deps.globalStoragePath)

		// F-008: allow loading preview bundle + mermaid UMD from extension dist.
		const webview = this.panel.webview
		const distUri = vscode.Uri.joinPath(deps.context.extensionUri, "dist")
		const previewScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "spec-preview.js"))
		const mermaidScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "mermaid.min.js"))

		this.panel.webview.html = buildSpecWorkspaceHtml(
			getNonce(),
			this.panel.webview.cspSource,
			previewScriptUri.toString(),
			mermaidScriptUri.toString(),
		)

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

		this.panel.webview.onDidReceiveMessage(
			(message: WebviewToHostMessage) => this.onMessage(message),
			null,
			this.disposables,
		)
	}

	/**
	 * Open or reveal the Spec Workspace panel.
	 */
	public static createOrShow(deps: SpecWorkspacePanelDeps): SpecWorkspacePanel {
		const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside

		if (SpecWorkspacePanel.current) {
			SpecWorkspacePanel.current.panel.reveal(column, true)
			void SpecWorkspacePanel.current.pushList()
			return SpecWorkspacePanel.current
		}

		const panel = vscode.window.createWebviewPanel(
			SpecWorkspacePanel.viewType,
			"Spec Workspace",
			{ viewColumn: column, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				// F-008: allow webview to load spec-preview.js + mermaid.min.js from dist.
				localResourceRoots: [vscode.Uri.joinPath(deps.context.extensionUri, "dist")],
			},
		)

		SpecWorkspacePanel.current = new SpecWorkspacePanel(panel, deps)
		return SpecWorkspacePanel.current
	}

	public static getCurrent(): SpecWorkspacePanel | undefined {
		return SpecWorkspacePanel.current
	}

	/** F-020: ensure panel exists for agent streaming (preserve focus). */
	public static ensureOpenForAgent(deps: SpecWorkspacePanelDeps): SpecWorkspacePanel {
		return SpecWorkspacePanel.createOrShow(deps)
	}

	/** Refresh pack list after external mutations (e.g. delete_spec tool). */
	public refreshList(): void {
		void this.pushList()
	}

	// --- F-020 agent stream API (UI-only until finalize) ---

	public notifyAgentWriteStarted(payload: AgentWriteStreamPayload): void {
		void this.post({
			type: "agentWriteStarted",
			streamId: payload.streamId,
			specId: payload.specId ?? null,
			title: payload.title ?? null,
			docKind: payload.docKind,
			mode: payload.mode,
			streaming: true,
		})
	}

	public notifyAgentWritePartial(payload: AgentWriteStreamPayload): void {
		void this.post({
			type: "agentWritePartial",
			streamId: payload.streamId,
			specId: payload.specId ?? null,
			title: payload.title ?? null,
			docKind: payload.docKind,
			mode: payload.mode,
			content: payload.content,
			append: payload.append,
			baseLen: payload.baseLen,
			fullResync: payload.fullResync === true,
			contentLength: payload.contentLength ?? payload.content?.length ?? 0,
			streaming: true,
		})
	}

	public notifyAgentWriteFinalized(payload: AgentWriteStreamPayload): void {
		void this.post({
			type: "agentWriteFinalized",
			streamId: payload.streamId,
			specId: payload.specId,
			title: payload.title ?? null,
			docKind: payload.docKind,
			mode: payload.mode,
			content: payload.content ?? "",
			revision: payload.revision,
			entries: payload.entries,
			streaming: false,
		})
	}

	public notifyAgentWriteAborted(
		payload: Pick<AgentWriteStreamPayload, "streamId" | "specId" | "docKind" | "reason">,
	): void {
		void this.post({
			type: "agentWriteAborted",
			streamId: payload.streamId,
			specId: payload.specId ?? null,
			docKind: payload.docKind,
			reason: payload.reason ?? "aborted",
			streaming: false,
		})
	}

	private log(message: string): void {
		this.outputChannel?.appendLine(`[SpecWorkspace] ${message}`)
	}

	private workspaceRoot(): string {
		const root = this.getWorkspaceRoot()
		if (!root) {
			throw new Error("No workspace folder open")
		}
		return root
	}

	private async onMessage(message: WebviewToHostMessage): Promise<void> {
		try {
			switch (message.type) {
				case "ready":
				case "refresh":
					await this.pushList()
					break
				case "createSpec":
					await this.createSpec(message.title)
					break
				case "importPlans":
					await this.importPlans()
					break
				case "exportSpec":
					await this.exportSpec()
					break
				case "deleteSpec":
					await this.deleteSpec(message.specId)
					break
				case "openDocument":
					await this.openDocument(message.specId, message.docKind)
					break
				case "openInEditor":
					await this.openInEditor(message.specId, message.docKind)
					break
				case "saveDocument":
					await this.saveDocument(message.specId, message.docKind, message.content)
					break
				case "aiSelectionAction":
					await this.handleAiSelectionAction(message)
					break
				default:
					break
			}
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error)
			this.log(`Error: ${text}`)
			await this.post({ type: "error", message: text })
		}
	}

	private async pushList(): Promise<void> {
		const root = this.workspaceRoot()
		const hash = hashWorkspaceRoot(root)
		const entries = await this.service.listWorkspaces(root)
		const last = loadLastOpened(this.context.workspaceState, hash)

		let activeSpecId = last?.specId
		let activeDocKind = last?.docKind ?? "requirements"

		// Drop stale last-open if spec was deleted
		if (activeSpecId && !entries.some((e) => e.id === activeSpecId)) {
			activeSpecId = entries[0]?.id
			activeDocKind = "requirements"
		} else if (!activeSpecId && entries[0]) {
			activeSpecId = entries[0].id
		}

		await this.post({
			type: "specsList",
			entries,
			activeSpecId,
			activeDocKind,
		})
	}

	private async createSpec(title: string): Promise<void> {
		const root = this.workspaceRoot()
		const workspace = await this.service.createWorkspace({
			title,
			workspaceRoot: root,
		})
		invalidateSpecContextCache()
		const hash = hashWorkspaceRoot(root)
		await saveLastOpened(this.context.workspaceState, hash, {
			specId: workspace.id,
			docKind: "requirements",
			workspaceRoot: root,
			updatedAt: Date.now(),
		})
		await this.pushList()
	}

	private async importPlans(): Promise<void> {
		const root = this.workspaceRoot()
		// F-023: dual filter — accept both .md (individual) and .zspec (package).
		const selected = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: true,
			defaultUri: vscode.Uri.file(root),
			filters: { "Spec packages": ["zspec"], Markdown: ["md"] },
			openLabel: "Preview Import",
		})
		if (!selected?.length) return

		const mdPaths: string[] = []
		const packagePaths: string[] = []
		for (const uri of selected) {
			const lower = uri.fsPath.toLowerCase()
			if (lower.endsWith(".zspec")) packagePaths.push(uri.fsPath)
			else mdPaths.push(uri.fsPath)
		}

		const created = []

		// Individual markdown files → one pack per file (existing F-011 flow).
		if (mdPaths.length) {
			const coordinator = new SpecImportCoordinator(this.service)
			const plan = await coordinator.planSelectedFiles(root, mdPaths)
			if (plan.candidates.length) {
				const summary = plan.candidates
					.map(
						(candidate) =>
							`${candidate.sourcePath}\n  → ${candidate.proposedKind} (${candidate.proposedTitle})`,
					)
					.join("\n")
				const confirmed = await vscode.window.showWarningMessage(
					`Import ${plan.candidates.length} markdown file(s) into virtual Spec Workspace? Sources may be anywhere; originals will not be modified.\n\n${summary}`,
					{ modal: true },
					"Import",
				)
				if (confirmed === "Import") {
					const packs = await coordinator.commit({ workspaceRoot: root, candidates: plan.candidates })
					created.push(...packs)
				}
			}
		}

		// Combined spec packages → one pack per package (new F-023 flow).
		const packageSkipped: Array<{ reason: string }> = []
		for (const packagePath of packagePaths) {
			try {
				const packageCoordinator = new SpecPackageCoordinator(this.service)
				const plan = await packageCoordinator.planImport(root, packagePath)
				const summary = plan.documents
					.map(
						(document) =>
							`${document.kind} · rev ${document.revision} (${document.title}, ${document.byteLength} bytes)`,
					)
					.join("\n")
				const confirmed = await vscode.window.showWarningMessage(
					`Import Combined Spec Package "${plan.proposedTitle}" (${plan.documents.length} doc(s), stage ${plan.proposedStage})?\n\n${packagePath}\n\n${summary}\n\nA new virtual pack will be created. Original package file is not modified.`,
					{ modal: true },
					"Import",
				)
				if (confirmed !== "Import") continue
				const pack = await packageCoordinator.commitImport({
					workspaceRoot: root,
					packagePath: plan.packagePath,
					proposedTitle: plan.proposedTitle,
				})
				created.push(pack)
			} catch (error) {
				packageSkipped.push({
					reason: `${packagePath}: ${error instanceof Error ? error.message : String(error)}`,
				})
			}
		}

		invalidateSpecContextCache()

		// Activate the first imported pack + its actual document kind.
		// Import may create only design/tasks/custom (not requirements). Without
		// saveLastOpened + correct docKind, webview opens "requirements" and shows
		// "Document not found" with an empty preview.
		const primary = created[0]
		if (primary) {
			const primaryDoc = primary.docs[0]
			const docKind = primaryDoc?.kind ?? primaryDoc?.id ?? "requirements"
			const hash = hashWorkspaceRoot(root)
			await saveLastOpened(this.context.workspaceState, hash, {
				specId: primary.id,
				docKind,
				workspaceRoot: root,
				updatedAt: Date.now(),
			})
			await this.pushList()
			await this.openDocument(primary.id, docKind)
		} else {
			await this.pushList()
		}

		await this.post({ type: "importCompleted", count: created.length, skipped: packageSkipped })
	}

	private async exportSpec(): Promise<void> {
		const root = this.workspaceRoot()
		const entries = await this.service.listWorkspaces(root)
		if (!entries.length) {
			await vscode.window.showWarningMessage("No spec workspaces to export.")
			return
		}

		const pick = await vscode.window.showQuickPick(
			entries.map((entry) => ({ label: entry.title, description: entry.stage, id: entry.id })),
			{ placeHolder: "Select spec to export" },
		)
		if (!pick) return

		const workspace = await this.service.getWorkspace(root, pick.id)
		if (!workspace) {
			await vscode.window.showWarningMessage("Selected spec was not found.")
			return
		}

		const docPicks = await vscode.window.showQuickPick(
			workspace.docs.map((doc) => ({
				label: doc.title,
				description: `${doc.kind} · rev ${doc.revision}`,
				id: doc.id,
				picked: true,
			})),
			{ canPickMany: true, placeHolder: "Select documents to export" },
		)
		if (!docPicks?.length) return

		// F-023: format quick pick — individual markdown (existing) vs combined package.
		const formatPick = await vscode.window.showQuickPick(
			[
				{
					label: "Individual Markdown files",
					description: "one .md per document",
					format: "markdown" as const,
				},
				{
					label: "Combined Spec Package (.zspec)",
					description: "one JSON bundle with metadata",
					format: "package" as const,
				},
			],
			{ placeHolder: "Choose export format" },
		)
		if (!formatPick) return

		if (formatPick.format === "package") {
			await this.exportSpecPackage(
				root,
				pick.id,
				docPicks.map((doc) => doc.id),
				workspace.title,
			)
			return
		}

		const targetFolders = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			defaultUri: vscode.Uri.file(root),
			openLabel: "Export Into Folder",
		})
		if (!targetFolders?.length) return

		// Destination may be any folder the user picks (project, Desktop, other repo).
		const destinationDirectory = targetFolders[0].fsPath

		const coordinator = new SpecExportCoordinator(this.service)
		const plan = await coordinator.plan({
			workspaceRoot: root,
			selections: docPicks.map((doc) => ({ specId: pick.id, docId: doc.id })),
			destinationDirectory,
		})
		if (!plan.items.length) {
			await vscode.window.showWarningMessage(
				`Nothing to export. ${plan.skipped.map((item) => item.reason).join(", ")}`,
			)
			return
		}

		const summary = plan.items
			.map(
				(item) =>
					`${item.absoluteTargetPath} [rev ${item.sourceRevision}] → ${item.targetExists ? "EXISTS (skip by default)" : "new"}`,
			)
			.join("\n")
		const confirmed = await vscode.window.showWarningMessage(
			`Export ${plan.items.length} file(s) to:\n${destinationDirectory}\n\n${summary}`,
			{ modal: true },
			"Export",
		)
		if (confirmed !== "Export") return

		const conflictResolutions: Record<string, SpecExportConflictAction> = {}
		const conflicts = plan.items.filter((item) => item.targetExists)
		if (conflicts.length) {
			const overwriteChoice = await vscode.window.showWarningMessage(
				`${conflicts.length} target file(s) already exist. Skip existing files, or overwrite all conflicts?`,
				{ modal: true },
				"Skip Existing",
				"Overwrite Existing",
			)
			if (!overwriteChoice) return
			if (overwriteChoice === "Overwrite Existing") {
				for (const item of conflicts) {
					conflictResolutions[item.relativePath] = "overwrite"
				}
			}
		}

		const result = await coordinator.commit({
			workspaceRoot: root,
			items: plan.items,
			conflictResolutions: Object.keys(conflictResolutions).length ? conflictResolutions : undefined,
		})
		const written = result.results.filter((r) => r.status === "created" || r.status === "overwritten").length
		const skipped = result.results.filter((r) => r.status === "skipped").length
		const failed = result.results.filter((r) => r.status === "failed")
		if (failed.length) {
			await vscode.window.showErrorMessage(
				`Export failed: ${failed[0].error ?? "unknown error"}${result.rollbackAttempted ? " (rolled back)" : ""}`,
			)
		} else {
			await vscode.window.showInformationMessage(`Export complete: ${written} written, ${skipped} skipped.`)
		}
		await this.post({
			type: "exportCompleted",
			written,
			skipped,
			failed: failed.length,
			rollbackAttempted: result.rollbackAttempted,
		})
	}

	/** F-023: export selected docs as one Combined Spec Package (.zspec). */
	private async exportSpecPackage(root: string, specId: string, docIds: string[], specTitle: string): Promise<void> {
		const defaultName = sanitizePackageFileName(specTitle)
		const defaultUri = vscode.Uri.file(
			// Build default save path under workspace root so user can relocate.
			`${root}/${defaultName}.zspec`,
		)
		const targetFile = await vscode.window.showSaveDialog({
			defaultUri,
			filters: { "Spec package": ["zspec"] },
			saveLabel: "Export Package",
			title: `Export Combined Spec Package for "${specTitle}"`,
		})
		if (!targetFile) return
		const destinationDocument = targetFile.fsPath

		const packageCoordinator = new SpecPackageCoordinator(this.service)
		let plan
		try {
			plan = await packageCoordinator.planExport({ workspaceRoot: root, specId, docIds }, destinationDocument)
		} catch (error) {
			await vscode.window.showErrorMessage(
				`Package export failed: ${error instanceof Error ? error.message : String(error)}`,
			)
			return
		}

		const summary = plan.pkg.documents
			.map((document) => `${document.kind} · rev ${document.revision} (${document.title})`)
			.join("\n")
		const confirmed = await vscode.window.showWarningMessage(
			`Export ${plan.pkg.documents.length} doc(s) into combined package?\n\n${destinationDocument}\n\n${summary}${plan.targetExists ? "\n\nWARNING: target file exists." : ""}`,
			{ modal: true },
			"Export",
		)
		if (confirmed !== "Export") return

		let conflictAction: "skip" | "overwrite" | undefined
		if (plan.targetExists) {
			const choice = await vscode.window.showWarningMessage(
				`Target file already exists:\n${destinationDocument}\n\nSkip or overwrite?`,
				{ modal: true },
				"Skip",
				"Overwrite",
			)
			if (!choice) return
			conflictAction = choice === "Overwrite" ? "overwrite" : "skip"
			if (conflictAction === "skip") {
				await vscode.window.showInformationMessage("Export skipped: target file exists.")
				return
			}
		}

		const result = await packageCoordinator.commitExport({ plan, conflictAction })
		if (result.status === "failed") {
			await vscode.window.showErrorMessage(`Package export failed: ${result.error ?? "unknown error"}`)
		} else if (result.status === "skipped") {
			await vscode.window.showInformationMessage("Package export skipped: target file exists.")
		} else {
			await vscode.window.showInformationMessage(`Combined Spec Package ${result.status}: ${result.path}`)
		}
		await this.post({
			type: "exportCompleted",
			written: result.status === "created" || result.status === "overwritten" ? 1 : 0,
			skipped: result.status === "skipped" ? 1 : 0,
			failed: result.status === "failed" ? 1 : 0,
			rollbackAttempted: false,
		})
	}

	private async deleteSpec(specId: string): Promise<void> {
		const root = this.workspaceRoot()
		const workspace = await this.service.getWorkspace(root, specId)
		const title = workspace?.title ?? specId
		const confirmed = await vscode.window.showWarningMessage(
			`Delete virtual spec "${title}"?\n\nThis removes the pack and its revision history from Spec Workspace only. Project files are not modified.`,
			{ modal: true },
			"Delete",
		)
		if (confirmed !== "Delete") return

		await this.service.deleteWorkspace(root, specId)
		invalidateSpecContextCache()

		const hash = hashWorkspaceRoot(root)
		const last = loadLastOpened(this.context.workspaceState, hash)
		if (last?.specId === specId) {
			await clearLastOpened(this.context.workspaceState, hash)
		}

		await this.pushList()
		await this.post({ type: "specDeleted", specId, title })
	}

	private async openDocument(specId: string, docKind: string): Promise<void> {
		const root = this.workspaceRoot()
		const doc = await this.service.getDocument(root, specId, docKind)
		if (!doc) {
			await this.post({ type: "error", message: `Document not found: ${docKind}` })
			return
		}

		const hash = hashWorkspaceRoot(root)
		await saveLastOpened(this.context.workspaceState, hash, {
			specId,
			docKind,
			workspaceRoot: root,
			updatedAt: Date.now(),
		})

		// Include docs metadata for dynamic numbered tab rendering
		const workspace = await this.service.getWorkspace(root, specId)
		const docs = workspace?.docs?.map((d) => ({ kind: d.kind, title: d.title })) ?? []

		await this.post({
			type: "document",
			specId,
			docKind: doc.meta.kind,
			title: doc.meta.title,
			revision: doc.meta.revision,
			content: doc.content,
			docs,
		})
	}

	private async openInEditor(specId: string, docKind: string): Promise<void> {
		const uri = buildSpecDocumentUri({
			workspaceRoot: this.workspaceRoot(),
			specId,
			docId: docKind,
		})
		const document = await vscode.workspace.openTextDocument(uri)
		await vscode.languages.setTextDocumentLanguage(document, "markdown")
		await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false })
	}

	private async saveDocument(specId: string, docKind: string, content: string): Promise<void> {
		const root = this.workspaceRoot()
		const updated = await this.service.writeDocument({
			specId,
			workspaceRoot: root,
			docIdOrKind: docKind,
			content,
		})

		invalidateSpecContextCache()

		const hash = hashWorkspaceRoot(root)
		await saveLastOpened(this.context.workspaceState, hash, {
			specId,
			docKind,
			workspaceRoot: root,
			updatedAt: Date.now(),
		})

		const entries = await this.service.listWorkspaces(root)
		await this.post({
			type: "saved",
			specId,
			docKind: updated.kind,
			title: updated.title,
			revision: updated.revision,
			entries,
		})
	}

	private post(message: Record<string, unknown>): Thenable<boolean> {
		return this.panel.webview.postMessage(message)
	}

	/**
	 * F-024/F-024b: Validates a webview selection action, re-resolves it against the
	 * authoritative document content, creates an opaque one-use token in the
	 * SelectionContextStore, retrieves the visible ClineProvider, and prefills a clean
	 * visible label via prepareSpecSelectionAction. Technical metadata is never
	 * exposed to the chat.
	 *
	 * The webview payload is treated as a *hint* only. All location data handed to the
	 * agent is derived host-side from the current document, so preview selections map
	 * back to source and one-word selections still carry a precise location. When the
	 * literal fragment cannot be re-located we anchor to the nearest heading section
	 * rather than sending an empty context.
	 */
	private async handleAiSelectionAction(
		message: Extract<WebviewToHostMessage, { type: "aiSelectionAction" }>,
	): Promise<void> {
		const validated = validateSelectionAction(message)
		if (!validated) {
			await this.post({ type: "error", message: "Invalid selection action payload." })
			return
		}

		const root = this.workspaceRoot()
		const workspace = await this.service.getWorkspace(root, validated.specId)
		const document = await this.service.getDocument(root, validated.specId, validated.docKind)
		// The spec/document itself must exist — there is nothing to anchor to otherwise.
		// A stale revision is *not* fatal: the resolver re-locates against current content.
		if (!workspace || !document) {
			await this.post({ type: "error", message: "The selected spec document is no longer available." })
			return
		}

		const provider = resolveVisibleClineProvider()
		if (!provider) {
			await this.post({ type: "error", message: "No visible chat provider available." })
			return
		}

		const resolved = resolveSelectionContext(document.content, {
			selectedText: validated.selectedText,
			startOffset: validated.startOffset,
			endOffset: validated.endOffset,
			startLine: validated.startLine,
			endLine: validated.endLine,
			mappingConfidence: validated.mappingConfidence,
		})

		const token = selectionContextStore.create({
			action: validated.action,
			specId: workspace.id,
			specTitle: workspace.title,
			documentKind: document.meta.kind,
			documentTitle: document.meta.title,
			revision: document.meta.revision,
			docOrder: validated.docOrder,
			docLabel: validated.docLabel,
			// Always the user's literal selection; the resolver supplies its location.
			selectedText: validated.selectedText,
			source: validated.source,
			startOffset: resolved.startOffset,
			endOffset: resolved.endOffset,
			startLine: resolved.startLine,
			endLine: resolved.endLine,
			mappingConfidence: resolved.mappingConfidence,
			degradedMapping: resolved.degraded || undefined,
			// A short common word can match in many places; when the context cannot
			// single one out, the agent must ask rather than edit the wrong one.
			ambiguousLocation: resolved.ambiguous || undefined,
			candidateCount: resolved.candidateCount > 1 ? resolved.candidateCount : undefined,
			headingPath: resolved.headingPath.length ? resolved.headingPath : undefined,
			blockType: resolved.blockType,
			taskNumber: resolved.taskNumber,
			taskTitle: resolved.taskTitle,
			currentPhase: resolved.currentPhase,
			listIndex: resolved.listIndex,
			parentListType: resolved.parentListType,
			nestingLevel: resolved.nestingLevel,
			tableHeading: resolved.tableHeading,
			tableColumn: resolved.tableColumn,
			tableColumns: resolved.tableColumns,
			tableRow: resolved.tableRow,
			tableRowText: resolved.tableRowText,
			tableRowsNearby: resolved.tableRowsNearby,
			mermaidDiagramType: resolved.mermaidDiagramType,
			mermaidFenceIndex: resolved.mermaidFenceIndex,
			surroundingBefore: resolved.surroundingBefore || undefined,
			surroundingAfter: resolved.surroundingAfter || undefined,
			parentHeading: resolved.parentHeading,
			siblingHeadings: resolved.siblingHeadings.length ? resolved.siblingHeadings : undefined,
			documentHash: resolved.documentHash,
			anchor: resolved.anchor,
			confidence: resolved.confidence,
			requirementId: resolved.requirementId,
			requirementTitle: resolved.requirementTitle,
			documentHeadingSummary: resolved.documentHeadingSummary,
			documentTaskCount: resolved.documentTaskCount,
			documentRequirementCount: resolved.documentRequirementCount,
			totalLines: resolved.totalLines,
		})
		await provider.prepareSpecSelectionAction(validated.action, token)
	}

	private dispose(): void {
		SpecWorkspacePanel.current = undefined
		while (this.disposables.length) {
			const d = this.disposables.pop()
			d?.dispose()
		}
	}
}

const SELECTION_ACTIONS = new Set<SelectionContextAction>([
	"rewrite",
	"improve",
	"remove",
	"custom",
	"summarize",
	"explain",
	"translate",
	"generate",
])
const MAX_SELECTION_TEXT_LENGTH = 32 * 1024

type ValidatedSelectionAction = Required<
	Pick<Extract<WebviewToHostMessage, { type: "aiSelectionAction" }>, "revision">
> &
	Extract<WebviewToHostMessage, { type: "aiSelectionAction" }>

function validateSelectionAction(message: unknown): ValidatedSelectionAction | undefined {
	if (!message || typeof message !== "object") return undefined
	const selection = message as Partial<Extract<WebviewToHostMessage, { type: "aiSelectionAction" }>>
	if (
		!SELECTION_ACTIONS.has(selection.action as SelectionContextAction) ||
		typeof selection.specId !== "string" ||
		!selection.specId ||
		typeof selection.docKind !== "string" ||
		!selection.docKind ||
		typeof selection.selectedText !== "string" ||
		!selection.selectedText ||
		selection.selectedText.length > MAX_SELECTION_TEXT_LENGTH ||
		(selection.source !== "editor" && selection.source !== "preview") ||
		(selection.mappingConfidence !== "exact" &&
			selection.mappingConfidence !== "approximate" &&
			selection.mappingConfidence !== "unmapped") ||
		!Number.isInteger(selection.revision) ||
		(selection.revision ?? 0) < 1
	) {
		return undefined
	}

	// Location is a *hint*, not a requirement. A preview selection that could not be
	// mapped back to source omits it entirely rather than fabricating line 1 / offset 0,
	// and the resolver re-locates the fragment host-side. Malformed values are still
	// rejected — an absent hint is honest, a nonsensical one is not.
	if (
		(selection.startLine !== undefined && (!Number.isInteger(selection.startLine) || selection.startLine < 1)) ||
		(selection.endLine !== undefined && (!Number.isInteger(selection.endLine) || selection.endLine < 1)) ||
		(selection.startLine !== undefined &&
			selection.endLine !== undefined &&
			selection.endLine < selection.startLine)
	) {
		return undefined
	}

	if (
		(selection.startOffset !== undefined &&
			(!Number.isInteger(selection.startOffset) || selection.startOffset < 0)) ||
		(selection.endOffset !== undefined && (!Number.isInteger(selection.endOffset) || selection.endOffset < 0)) ||
		(selection.startOffset !== undefined &&
			selection.endOffset !== undefined &&
			selection.endOffset < selection.startOffset)
	) {
		return undefined
	}

	return selection as ValidatedSelectionAction
}

/** F-023: sanitize a spec title into a safe package base filename (no extension). */
function sanitizePackageFileName(title: string): string {
	const base = title
		.replace(/[/\\:*?"<>|]/g, "-")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)
	return base || "spec"
}
