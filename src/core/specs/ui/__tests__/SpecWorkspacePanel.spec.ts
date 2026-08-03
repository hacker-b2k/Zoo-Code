import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type * as vscode from "vscode"

import { SpecService } from "../../SpecService"
import { hashWorkspaceRoot } from "../../paths"
import { loadLastOpened } from "../specUiState"

let messageHandler: ((msg: unknown) => void | Promise<void>) | undefined
const postMessage = vi.fn().mockResolvedValue(true)
const reveal = vi.fn()
const showOpenDialog = vi.fn()
const showWarningMessage = vi.fn()
const showErrorMessage = vi.fn()
const showInformationMessage = vi.fn()
const showQuickPick = vi.fn()

const workspaceStateStore = new Map<string, unknown>()
const mockWorkspaceState = {
	get: <T>(key: string, defaultValue?: T) =>
		(workspaceStateStore.has(key) ? workspaceStateStore.get(key) : defaultValue) as T,
	update: async (key: string, value: unknown) => {
		if (value === undefined) workspaceStateStore.delete(key)
		else workspaceStateStore.set(key, value)
	},
}

vi.mock("vscode", () => {
	// Minimal Uri helper for joinPath used by F-008 SpecWorkspacePanel.
	const Uri = {
		joinPath: (base: any, ...segments: string[]) => ({
			fsPath: [base?.fsPath ?? base, ...segments].join("/"),
			toString: () => [base?.fsPath ?? base, ...segments].join("/"),
			path: [base?.fsPath ?? base, ...segments].join("/"),
		}),
		file: (p: string) => ({ fsPath: p, toString: () => p, path: p }),
	}
	return {
		Uri,
		window: {
			createWebviewPanel: vi.fn(() => ({
				webview: {
					html: "",
					cspSource: "vscode-webview:",
					postMessage,
					asWebviewUri: (localUri: any) => ({
						toString: () => "vscode-webview://" + (localUri?.path ?? localUri?.fsPath ?? String(localUri)),
					}),
					onDidReceiveMessage: (cb: (msg: unknown) => void) => {
						messageHandler = cb
						return { dispose: vi.fn() }
					},
				},
				reveal,
				onDidDispose: () => ({ dispose: vi.fn() }),
			})),
			activeTextEditor: undefined,
			createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
			createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn() })),
			showOpenDialog: (...args: unknown[]) => showOpenDialog(...args),
			showWarningMessage: (...args: unknown[]) => showWarningMessage(...args),
			showErrorMessage: (...args: unknown[]) => showErrorMessage(...args),
			showInformationMessage: (...args: unknown[]) => showInformationMessage(...args),
			showQuickPick: (...args: unknown[]) => showQuickPick(...args),
			showSaveDialog: vi.fn().mockResolvedValue(undefined),
		},
		workspace: {
			fs: {
				readFile: vi.fn(),
				writeFile: vi.fn(),
				stat: vi.fn(),
				createDirectory: vi.fn(),
				exists: vi.fn(),
				delete: vi.fn(),
			},
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(),
				onDidChange: vi.fn(),
				onDidDelete: vi.fn(),
				dispose: vi.fn(),
			})),
			getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
			onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
			onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
		},
		commands: {
			registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
			executeCommand: vi.fn().mockResolvedValue(undefined),
		},
		languages: {
			setTextDocumentLanguage: vi.fn().mockResolvedValue(undefined),
		},
		ViewColumn: { Beside: 2, One: 1, Active: -1 },
		Disposable: { from: vi.fn() },
		EventEmitter: vi.fn(() => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() })),
		StatusBarAlignment: { Left: 1, Right: 2 },
		ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
	}
})

const prepareSpecSelectionAction = vi.fn().mockResolvedValue(undefined)
const getVisibleInstance = vi.fn()

vi.mock("../../../webview/ClineProvider", () => ({
	ClineProvider: { getVisibleInstance },
}))

import { SpecWorkspacePanel } from "../SpecWorkspacePanel"
import { selectionContextStore } from "../../selection/SelectionContextStore"
import { setClineProviderAccessor } from "../clineProviderAccessor"
import { specDocumentEvents } from "../../specDocumentEvents"

describe("SpecWorkspacePanel", () => {
	let globalStorage: string
	let projectRoot: string

	beforeEach(async () => {
		globalStorage = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-ui-global-"))
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-ui-project-"))
		workspaceStateStore.clear()
		postMessage.mockClear()
		showOpenDialog.mockReset()
		showWarningMessage.mockReset()
		showErrorMessage.mockReset()
		showInformationMessage.mockReset()
		showQuickPick.mockReset()
		prepareSpecSelectionAction.mockClear()
		getVisibleInstance.mockReset()
		messageHandler = undefined
		;(SpecWorkspacePanel as unknown as { current?: unknown }).current = undefined
		// Wire up the injectable ClineProvider accessor so tests can inject mocks
		// without relying on vitest dynamic-import interception.
		setClineProviderAccessor(() => getVisibleInstance() ?? undefined)
	})

	afterEach(async () => {
		;(SpecWorkspacePanel as unknown as { current?: unknown }).current = undefined
		// Best-effort cleanup (Windows may briefly lock temp files)
		await fs.rm(globalStorage, { recursive: true, force: true }).catch(() => {})
		await fs.rm(projectRoot, { recursive: true, force: true }).catch(() => {})
	})

	function createPanel() {
		const context = {
			workspaceState: mockWorkspaceState,
			// F-008: extensionUri used to resolve dist/ for preview + mermaid scripts.
			extensionUri: { fsPath: "/ext-root", toString: () => "/ext-root", path: "/ext-root" },
		} as unknown as vscode.ExtensionContext

		return SpecWorkspacePanel.createOrShow({
			context,
			globalStoragePath: globalStorage,
			getWorkspaceRoot: () => projectRoot,
		})
	}

	async function send(msg: unknown) {
		expect(messageHandler).toBeTypeOf("function")
		await Promise.resolve(messageHandler!(msg))
		// Drain microtasks from chained awaits
		await new Promise((r) => setTimeout(r, 50))
	}

	async function waitForPost(type: string, timeoutMs = 3000) {
		const start = Date.now()
		while (Date.now() - start < timeoutMs) {
			const found = postMessage.mock.calls.map((c) => c[0]).find((m: any) => m?.type === type)
			if (found) return found
			await new Promise((r) => setTimeout(r, 20))
		}
		throw new Error(
			`Timed out waiting for postMessage type=${type}. Calls: ${JSON.stringify(postMessage.mock.calls)}`,
		)
	}

	it("lists empty specs and does not write to project root", async () => {
		createPanel()
		await send({ type: "ready" })
		const listMsg = await waitForPost("specsList")
		expect(listMsg).toMatchObject({ type: "specsList", entries: [] })
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("creates a spec via SpecService under global storage only", async () => {
		createPanel()
		await send({ type: "createSpec", title: "UI Spec" })

		const listMsg = await waitForPost("specsList")
		expect((listMsg as any).entries).toHaveLength(1)
		expect((listMsg as any).entries[0].title).toBe("UI Spec")

		const service = new SpecService(globalStorage)
		const list = await service.listWorkspaces(projectRoot)
		expect(list).toHaveLength(1)

		const hash = hashWorkspaceRoot(projectRoot)
		const last = loadLastOpened(mockWorkspaceState as any, hash)
		expect(last?.specId).toBe(list[0].id)
		expect(await fs.readdir(projectRoot)).toEqual([])

		const specsRoot = path.join(globalStorage, "specs", hash)
		const entries = await fs.readdir(specsRoot)
		expect(entries.length).toBeGreaterThan(0)
	})

	it("saves document content and restores last-opened after new panel", async () => {
		createPanel()
		await send({ type: "createSpec", title: "Persist" })
		const listMsg = await waitForPost("specsList")
		const entry = (listMsg as any).entries[0]
		expect(entry?.id).toBeTruthy()

		postMessage.mockClear()
		await send({
			type: "saveDocument",
			specId: entry.id,
			docKind: "design",
			content: "# Design from UI\n",
		})
		const saved = await waitForPost("saved")
		expect(saved).toMatchObject({ type: "saved", revision: 2 })

		const service = new SpecService(globalStorage)
		const doc = await service.getDocument(projectRoot, entry.id, "design")
		expect(doc?.content).toBe("# Design from UI\n")

		// Simulate restart: new panel, same storage + workspaceState
		;(SpecWorkspacePanel as unknown as { current?: unknown }).current = undefined
		postMessage.mockClear()
		createPanel()
		await send({ type: "ready" })
		const restored = await waitForPost("specsList")
		expect(restored).toMatchObject({
			type: "specsList",
			activeSpecId: entry.id,
		})

		const hash = hashWorkspaceRoot(projectRoot)
		const last = loadLastOpened(mockWorkspaceState as any, hash)
		expect(last?.docKind).toBe("design")
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("F-008: passes preview + mermaid script URIs into webview HTML", () => {
		const panel = createPanel()
		// Capture the html generated by the constructor via the mocked webview.
		const html = (panel as unknown as { panel: { webview: { html: string } } }).panel.webview.html
		expect(html).toContain("spec-preview.js")
		expect(html).toContain("mermaid.min.js")
		expect(html).toContain("pane-grid")
		expect(html).toContain("'unsafe-eval'")
	})

	it("post-import activates imported pack with actual doc kind (no Document not found)", async () => {
		// Import a design-only markdown file. Pre-fix opened "requirements" by default
		// and showed "Document not found" because the pack only had design.
		const designPath = path.join(projectRoot, "architecture-design.md")
		await fs.writeFile(designPath, "# Imported Design\n\nbody\n", "utf8")

		showOpenDialog.mockResolvedValueOnce([{ fsPath: designPath }])
		showWarningMessage.mockResolvedValueOnce("Import")

		createPanel()
		postMessage.mockClear()
		await send({ type: "importPlans" })

		const documentMsg = await waitForPost("document")
		expect(documentMsg).toMatchObject({
			type: "document",
			docKind: "design",
			content: "# Imported Design\n\nbody\n",
		})
		expect((documentMsg as any).specId).toBeTruthy()

		const listMsg = postMessage.mock.calls.map((c) => c[0]).find((m: any) => m?.type === "specsList")
		expect(listMsg).toMatchObject({
			type: "specsList",
			activeSpecId: (documentMsg as any).specId,
			activeDocKind: "design",
		})

		const errors = postMessage.mock.calls
			.map((c) => c[0])
			.filter((m: any) => m?.type === "error" && String(m.message).includes("Document not found"))
		expect(errors).toEqual([])

		const hash = hashWorkspaceRoot(projectRoot)
		const last = loadLastOpened(mockWorkspaceState as any, hash)
		expect(last?.specId).toBe((documentMsg as any).specId)
		expect(last?.docKind).toBe("design")

		const completed = await waitForPost("importCompleted")
		expect(completed).toMatchObject({ type: "importCompleted", count: 1 })
		expect(await fs.readFile(designPath, "utf8")).toBe("# Imported Design\n\nbody\n")
	})

	it("export accepts nested in-workspace folder (docs/) without false outside error", async () => {
		createPanel()
		await send({ type: "createSpec", title: "Export UI" })
		const listMsg = await waitForPost("specsList")
		const entry = (listMsg as any).entries[0]
		expect(entry?.id).toBeTruthy()

		const nestedDir = path.join(projectRoot, "docs", "specs")
		await fs.mkdir(nestedDir, { recursive: true })

		showQuickPick
			.mockResolvedValueOnce({ label: "Export UI", description: "requirements", id: entry.id })
			.mockResolvedValueOnce([{ label: "Requirements", id: "requirements", picked: true }])
			.mockResolvedValueOnce({
				label: "Individual Markdown files",
				description: "one .md per document",
				format: "markdown",
			})
		showOpenDialog.mockResolvedValueOnce([{ fsPath: nestedDir }])
		showWarningMessage.mockResolvedValueOnce("Export")

		postMessage.mockClear()
		await send({ type: "exportSpec" })

		const completed = await waitForPost("exportCompleted")
		expect(completed).toMatchObject({ type: "exportCompleted", written: 1, failed: 0 })
		expect(showErrorMessage).not.toHaveBeenCalled()
		const exported = await fs.readFile(path.join(nestedDir, "requirements.md"), "utf8")
		expect(exported.length).toBeGreaterThan(0)
	})

	it("export accepts destination outside the project workspace", async () => {
		createPanel()
		await send({ type: "createSpec", title: "Export Outside" })
		const listMsg = await waitForPost("specsList")
		const entry = (listMsg as any).entries[0]

		const outside = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-spec-ui-export-out-"))
		try {
			showQuickPick
				.mockResolvedValueOnce({ label: "Export Outside", description: "requirements", id: entry.id })
				.mockResolvedValueOnce([{ label: "Requirements", id: "requirements", picked: true }])
				.mockResolvedValueOnce({
					label: "Individual Markdown files",
					description: "one .md per document",
					format: "markdown",
				})
			showOpenDialog.mockResolvedValueOnce([{ fsPath: outside }])
			showWarningMessage.mockResolvedValueOnce("Export")

			postMessage.mockClear()
			await send({ type: "exportSpec" })

			const completed = await waitForPost("exportCompleted")
			expect(completed).toMatchObject({ type: "exportCompleted", written: 1, failed: 0 })
			expect(showErrorMessage).not.toHaveBeenCalled()
			expect((await fs.readFile(path.join(outside, "requirements.md"), "utf8")).length).toBeGreaterThan(0)
		} finally {
			await fs.rm(outside, { recursive: true, force: true })
		}
	})

	it("hands a validated selection to the visible chat using only an opaque token", async () => {
		getVisibleInstance.mockReturnValue({ prepareSpecSelectionAction })
		createPanel()
		await send({ type: "createSpec", title: "Selection Spec" })
		const listMsg = await waitForPost("specsList")
		const entry = (listMsg as any).entries[0]
		const document = await new SpecService(globalStorage).getDocument(projectRoot, entry.id, "requirements")
		expect(document).not.toBeNull()

		const selectedText = document!.content.slice(0, 3)
		await send({
			type: "aiSelectionAction",
			action: "rewrite",
			specId: entry.id,
			docKind: "requirements",
			selectedText,
			source: "editor",
			startOffset: 0,
			endOffset: 3,
			startLine: 1,
			endLine: 1,
			mappingConfidence: "exact",
			revision: document!.meta.revision,
		})

		// handleAiSelectionAction chains multiple awaits including a dynamic
		// import(); poll until the chat handoff fires or an error is posted.
		const start = Date.now()
		while (Date.now() - start < 3000) {
			if (prepareSpecSelectionAction.mock.calls.length) break
			const errored = postMessage.mock.calls.map((c) => c[0]).find((m: any) => m?.type === "error")
			if (errored) {
				throw new Error(`Selection action posted an error: ${(errored as any).message}`)
			}
			await new Promise((r) => setTimeout(r, 20))
		}
		expect(prepareSpecSelectionAction).toHaveBeenCalledTimes(1)
		const [action, token] = prepareSpecSelectionAction.mock.calls[0]
		expect(action).toBe("rewrite")
		expect(token).toEqual(expect.any(String))
		expect(token).not.toContain(selectedText)
		const context = selectionContextStore.consume(token)
		expect(context).toMatchObject({
			action: "rewrite",
			specId: entry.id,
			specTitle: "Selection Spec",
			documentKind: "requirements",
			documentTitle: document!.meta.title,
			selectedText,
		})
	})

	it("resolves a one-word preview selection that carries no location hint", async () => {
		getVisibleInstance.mockReturnValue({ prepareSpecSelectionAction })
		createPanel()
		await send({ type: "createSpec", title: "Banking System Architecture" })
		const listMsg = await waitForPost("specsList")
		const entry = (listMsg as any).entries[0]

		const content = [
			"# Banking System Architecture",
			"",
			"## Features",
			"",
			"| Feature | Status |",
			"| Login | Done |",
			"| Payments | Planned |",
		].join("\n")
		await send({ type: "saveDocument", specId: entry.id, docKind: "requirements", content })
		await waitForPost("saved")
		const document = await new SpecService(globalStorage).getDocument(projectRoot, entry.id, "requirements")

		// A preview selection of a single word, with no offsets and no line numbers —
		// the shape that previously failed validation and produced "context not found".
		await send({
			type: "aiSelectionAction",
			action: "explain",
			specId: entry.id,
			docKind: "requirements",
			selectedText: "Payments",
			source: "preview",
			mappingConfidence: "unmapped",
			revision: document!.meta.revision,
		})

		const started = Date.now()
		while (Date.now() - started < 3000) {
			if (prepareSpecSelectionAction.mock.calls.length) break
			const errored = postMessage.mock.calls.map((c) => c[0]).find((m: any) => m?.type === "error")
			if (errored) {
				throw new Error(`Selection action posted an error: ${(errored as any).message}`)
			}
			await new Promise((r) => setTimeout(r, 20))
		}
		expect(prepareSpecSelectionAction).toHaveBeenCalledTimes(1)

		const [, token] = prepareSpecSelectionAction.mock.calls[0]
		const context = selectionContextStore.consume(token)
		// The host re-located the word and supplied a real position and section.
		expect(context).toMatchObject({
			selectedText: "Payments",
			specTitle: "Banking System Architecture",
			startLine: 7,
			endLine: 7,
			parentHeading: "Features",
			blockType: "table",
		})
		expect(context?.headingPath).toEqual(["Banking System Architecture", "Features"])
		expect(context?.tableRowText).toContain("Payments")
	})

	it("rejects stale or malformed selection actions without invoking chat", async () => {
		getVisibleInstance.mockReturnValue({ prepareSpecSelectionAction })
		createPanel()
		await send({
			type: "aiSelectionAction",
			action: "rewrite",
			specId: "unknown",
			docKind: "requirements",
			selectedText: "text",
			source: "editor",
			startOffset: 0,
			endOffset: 4,
			startLine: 1,
			endLine: 1,
			mappingConfidence: "exact",
			revision: 1,
		})

		expect(prepareSpecSelectionAction).not.toHaveBeenCalled()
		const error = await waitForPost("error")
		expect(error).toMatchObject({ type: "error" })
	})

	it("deleteSpec removes virtual pack, clears lastOpened, leaves project empty", async () => {
		createPanel()
		await send({ type: "createSpec", title: "To Delete" })
		const listMsg = await waitForPost("specsList")
		const entry = (listMsg as any).entries[0]
		expect(entry?.id).toBeTruthy()

		showWarningMessage.mockResolvedValueOnce("Delete")
		postMessage.mockClear()
		await send({ type: "deleteSpec", specId: entry.id })

		const deleted = await waitForPost("specDeleted")
		expect(deleted).toMatchObject({ type: "specDeleted", specId: entry.id })

		const service = new SpecService(globalStorage)
		expect(await service.getWorkspace(projectRoot, entry.id)).toBeNull()
		expect(await service.listWorkspaces(projectRoot)).toEqual([])
		expect(await fs.readdir(projectRoot)).toEqual([])

		const hash = hashWorkspaceRoot(projectRoot)
		const last = loadLastOpened(mockWorkspaceState as any, hash)
		expect(last).toBeUndefined()
	})

	// -----------------------------------------------------------------------
	// Regression: live doc updates without close-reopen (field-reported bug).
	//
	// Bug behavior: spec card appeared instantly, but requirements/design/tasks
	// tab content never updated when the agent wrote to it; Refresh didn't help;
	// only closing and reopening the panel showed the content.
	//
	// Root causes fixed:
	//  1. The panel never subscribed to the shared specDocumentEvents bus, so
	//     committed writes from OTHER SpecService instances (the agent's
	//     WriteSpecTool uses its own instance) never reached the webview.
	//  2. Refresh only pushed the card list, never the active document.
	//  3. The webview's blanket agentStreaming guard dropped every document
	//     message whenever a finalize signal was lost (e.g. listWorkspaces
	//     failure inside the shared best-effort try/catch in WriteSpecTool),
	//     wedging the panel permanently.
	// -----------------------------------------------------------------------

	it("live-updates active document when an external SpecService writes to it (event-driven)", async () => {
		createPanel()
		await send({ type: "createSpec", title: "LiveDoc" })
		const listMsg = await waitForPost("specsList")
		const entry = (listMsg as any).entries[0]

		// Open the requirements doc so the panel tracks it as active.
		postMessage.mockClear()
		await send({ type: "openDocument", specId: entry.id, docKind: "requirements" })
		const initialDoc = await waitForPost("document")
		expect(initialDoc).toMatchObject({ type: "document", specId: entry.id, docKind: "requirements" })

		// Simulate the agent writing to the SAME doc via a DIFFERENT SpecService
		// instance (exactly what WriteSpecTool does via getSpecServiceForTask —
		// previously invisible to the panel until close-reopen).
		postMessage.mockClear()
		const externalService = new SpecService(globalStorage)
		await externalService.writeDocument({
			specId: entry.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "requirements",
			content: "# Live-updated requirements\n\nWritten by the agent.\n",
		})

		// The event bus must trigger a fresh document push with new content+revision.
		const pushedDoc = await waitForPost("document")
		expect(pushedDoc).toMatchObject({
			type: "document",
			specId: entry.id,
			docKind: "requirements",
		})
		expect((pushedDoc as any).content).toBe("# Live-updated requirements\n\nWritten by the agent.\n")
		expect((pushedDoc as any).revision).toBe(2)
	})

	it("live-updates card list when an external SpecService creates a pack (event-driven)", async () => {
		createPanel()
		await send({ type: "ready" })
		await waitForPost("specsList")

		// External instance creates a new pack — card must appear without
		// any manual refresh.
		postMessage.mockClear()
		const externalService = new SpecService(globalStorage)
		await externalService.createWorkspace({ title: "External Pack", workspaceRoot: projectRoot })

		const listMsg = await waitForPost("specsList")
		expect((listMsg as any).entries).toHaveLength(1)
		expect((listMsg as any).entries[0].title).toBe("External Pack")
	})

	it("refresh re-pushes BOTH the card list and the active document content", async () => {
		createPanel()
		await send({ type: "createSpec", title: "RefreshTest" })
		const listMsg = await waitForPost("specsList")
		const entry = (listMsg as any).entries[0]

		await send({ type: "openDocument", specId: entry.id, docKind: "design" })
		await waitForPost("document")

		// Mutate the design doc externally, then hit Refresh — the fresh content
		// must be re-pushed (previously Refresh only pushed the list).
		const externalService = new SpecService(globalStorage)
		await externalService.writeDocument({
			specId: entry.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "design",
			content: "# Fresh design after refresh\n",
		})

		postMessage.mockClear()
		await send({ type: "refresh" })

		const listMsg2 = await waitForPost("specsList")
		expect(listMsg2).toMatchObject({ type: "specsList" })
		const docMsg = await waitForPost("document")
		expect(docMsg).toMatchObject({ type: "document", specId: entry.id, docKind: "design" })
		expect((docMsg as any).content).toBe("# Fresh design after refresh\n")
	})

	it("event-driven re-push is skipped while a stream owns the active doc (stream is authoritative)", async () => {
		createPanel()
		await send({ type: "createSpec", title: "StreamGuard" })
		const listMsg = await waitForPost("specsList")
		const entry = (listMsg as any).entries[0]

		const panel = SpecWorkspacePanel.getCurrent()!

		// Simulate agent stream start for this exact doc.
		panel.notifyAgentWriteStarted({
			streamId: "stream-1",
			specId: entry.id,
			docKind: "requirements",
			mode: "update",
			title: "StreamGuard",
		})

		// External commit to the SAME doc mid-stream: the panel must NOT re-push
		// a document message (the stream's partial/finalized messages own it).
		postMessage.mockClear()
		const externalService = new SpecService(globalStorage)
		await externalService.writeDocument({
			specId: entry.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "requirements",
			content: "# External mid-stream write\n",
		})

		// Card list MAY refresh (allowed) but no document push must occur.
		await new Promise((r) => setTimeout(r, 200))
		const docPushes = postMessage.mock.calls.map((c) => c[0]).filter((m: any) => m?.type === "document")
		expect(docPushes).toHaveLength(0)

		// After finalize, the stream no longer owns the doc — a subsequent
		// external write MUST live-update again.
		panel.notifyAgentWriteFinalized({
			streamId: "stream-1",
			specId: entry.id,
			docKind: "requirements",
			mode: "update",
			title: "StreamGuard",
			content: "# Final streamed content\n",
			revision: 3,
			entries: [],
		})

		postMessage.mockClear()
		await externalService.writeDocument({
			specId: entry.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "requirements",
			content: "# Post-stream external write\n",
		})
		const docMsg = await waitForPost("document")
		expect((docMsg as any).content).toBe("# Post-stream external write\n")
	})

	it("event-driven re-push to a DIFFERENT doc than the active one does not disturb the view", async () => {
		createPanel()
		await send({ type: "createSpec", title: "MultiDoc" })
		const listMsg = await waitForPost("specsList")
		const entry = (listMsg as any).entries[0]

		// Active doc = requirements.
		await send({ type: "openDocument", specId: entry.id, docKind: "requirements" })
		await waitForPost("document")

		// External write to design (NOT the active doc): list may refresh but
		// no document push should target the active requirements view.
		postMessage.mockClear()
		const externalService = new SpecService(globalStorage)
		await externalService.writeDocument({
			specId: entry.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "design",
			content: "# Design updated in background\n",
		})
		await new Promise((r) => setTimeout(r, 200))
		const docPushes = postMessage.mock.calls.map((c) => c[0]).filter((m: any) => m?.type === "document")
		expect(docPushes).toHaveLength(0)

		// When the user then switches to the design tab, the fresh content loads.
		await send({ type: "openDocument", specId: entry.id, docKind: "design" })
		const designDoc = await waitForPost("document")
		expect((designDoc as any).content).toBe("# Design updated in background\n")
	})

	it("specDocumentEvents bus emits for writeDocument (infrastructure guard)", async () => {
		const events: Array<{ specId: string; docId: string; revision: number }> = []
		const sub = specDocumentEvents.onDocumentChanged((e) => {
			events.push({ specId: e.specId, docId: e.docId, revision: e.revision })
		})
		try {
			const service = new SpecService(globalStorage)
			const ws = await service.createWorkspace({ title: "BusCheck", workspaceRoot: projectRoot })
			await service.writeDocument({
				specId: ws.id,
				workspaceRoot: projectRoot,
				docIdOrKind: "requirements",
				content: "# Bus check\n",
			})
			const writeEvents = events.filter((e) => e.specId === ws.id && e.docId === "requirements")
			expect(writeEvents.length).toBeGreaterThanOrEqual(1)
			expect(writeEvents.at(-1)!.revision).toBeGreaterThanOrEqual(1)
		} finally {
			sub.dispose()
		}
	})
})
