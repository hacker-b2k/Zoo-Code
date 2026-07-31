import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import {
	coerceOptionalSpecId,
	hashWorkspaceRoot,
	isTruncatedDisplaySpecId,
	truncatedSpecIdErrorMessage,
} from "../specs/paths"
import { getSpecServiceForTask, getSpecWorkspaceRoot, resolveExistingSpecIdSoft } from "../specs/getSpecServiceForTask"
import { SpecWorkspacePanel, type AgentWriteStreamPayload } from "../specs/ui/SpecWorkspacePanel"
import { saveLastOpened } from "../specs/ui/specUiState"
import { normalizeWriteSpecMode, resolveWriteBody, applyBatchSearchReplace } from "../specs/specMerge"
import { invalidateSpecContextCache } from "../specs/specContext"

const LOG_PREFIX = "[write_spec]"

/** Structured Spec Workspace logging (extension host console / Output). */
function logWriteSpec(level: "info" | "warn" | "error", message: string, details?: Record<string, unknown>): void {
	const payload = details ? ` ${JSON.stringify(details)}` : ""
	const line = `${LOG_PREFIX} ${message}${payload}`
	if (level === "error") {
		console.error(line)
	} else if (level === "warn") {
		console.warn(line)
	} else {
		console.info(line)
	}
}

interface WriteSpecParams {
	/** Required non-empty when creating (spec_id null); optional on update. */
	title?: string | null
	spec_id?: string | null
	doc: string
	/** Full body for replace; chunk for append/upsert_section; optional for search_replace. */
	content?: string
	mode?: string | null
	section_heading?: string | null
	old_string?: string | null
	new_string?: string | null
	replace_all?: boolean | null
	/** Preview changes without applying (Issue #5). */
	dry_run?: boolean | null
	/** Batch of search_replace operations (Issue #6). */
	replacements?: Array<{ old_string: string; new_string: string; replace_all?: boolean }> | null
}

/** F-020b Phase A: ~1–2 frames; time-only throttle (no large char gate). */
const PARTIAL_THROTTLE_MS = 24

const KNOWN_DOC_KINDS = new Set(["requirements", "design", "tasks"])

/**
 * write_spec — create and/or full-write a virtual Spec document (F-004).
 * F-020: streams draft content to Spec Workspace UI (preview only); SpecService
 * only on successful execute.
 * F-020b: low-latency throttle + append-only partials when content grows as a prefix.
 * Uses SpecService only — never writes into the project workspace.
 */
export class WriteSpecTool extends BaseTool<"write_spec"> {
	readonly name = "write_spec" as const

	private streamId: string | null = null
	private lastPartialPostAt = 0
	private lastPostedContent = ""
	private lastSeenDoc: string | undefined
	private lastSeenTitle: string | undefined
	private streamMode: "create" | "update" = "update"
	private streamSpecId: string | null = null
	private streamDocKind: string | null = null
	private streamTitle: string | null = null
	private streamStarted = false
	/** Latest content pending send (latest-wins coalesce). */
	private pendingContent: string | null = null
	private coalesceTimer: ReturnType<typeof setTimeout> | null = null

	override async handlePartial(task: Task, block: ToolUse<"write_spec">): Promise<void> {
		const args = (block.nativeArgs ?? {}) as Partial<WriteSpecParams>
		const params = block.params ?? {}

		const rawDoc = (args.doc ?? params.doc) as string | undefined
		const rawTitle = (args.title ?? (params as { title?: string }).title) as string | undefined
		const rawSpecId = args.spec_id !== undefined ? args.spec_id : (params as { spec_id?: string }).spec_id
		const rawContent = args.content !== undefined ? args.content : params.content

		// F-020b: known kinds accepted immediately; others still double-stabilize
		if (!this.isDocReady(rawDoc)) {
			return
		}
		const doc = String(rawDoc).trim()
		if (!doc) {
			return
		}

		const content = typeof rawContent === "string" ? rawContent : undefined
		if (content === undefined) {
			return
		}

		const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : this.streamTitle

		if (typeof rawTitle === "string" && rawTitle.trim()) {
			if (this.lastSeenTitle !== undefined && this.lastSeenTitle === rawTitle.trim()) {
				this.streamTitle = rawTitle.trim()
			}
			this.lastSeenTitle = rawTitle.trim()
		}

		const coercedId = coerceOptionalSpecId(rawSpecId)
		const mode: "create" | "update" = coercedId ? "update" : "create"
		this.streamMode = mode
		this.streamSpecId = coercedId
		this.streamDocKind = doc
		if (title) {
			this.streamTitle = title
		}

		if (!this.streamId) {
			this.streamId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
		}

		const panel = this.ensurePanel(task)
		if (!panel) {
			return
		}

		if (!this.streamStarted) {
			this.streamStarted = true
			panel.notifyAgentWriteStarted({
				streamId: this.streamId,
				specId: this.streamSpecId,
				title: this.streamTitle,
				docKind: doc,
				mode,
			})
		}

		// Latest-wins: always keep newest content; flush on throttle
		this.pendingContent = content
		const now = Date.now()
		const elapsed = now - this.lastPartialPostAt
		if (this.lastPartialPostAt > 0 && elapsed < PARTIAL_THROTTLE_MS) {
			if (!this.coalesceTimer) {
				const wait = PARTIAL_THROTTLE_MS - elapsed
				this.coalesceTimer = setTimeout(() => {
					this.coalesceTimer = null
					this.flushPendingPartial(panel)
				}, wait)
			}
			return
		}

		this.flushPendingPartial(panel)
	}

	private flushPendingPartial(panel: SpecWorkspacePanel): void {
		if (this.pendingContent === null || !this.streamId || !this.streamDocKind) {
			return
		}
		const content = this.pendingContent
		this.pendingContent = null
		const now = Date.now()
		this.lastPartialPostAt = now

		const prev = this.lastPostedContent
		const canAppend = prev.length > 0 && content.length >= prev.length && content.startsWith(prev)
		const append = canAppend ? content.slice(prev.length) : undefined

		const payload: AgentWriteStreamPayload = {
			streamId: this.streamId,
			specId: this.streamSpecId,
			title: this.streamTitle,
			docKind: this.streamDocKind,
			mode: this.streamMode,
			contentLength: content.length,
		}

		if (canAppend && append !== undefined) {
			// F-020b Phase B: send only the new suffix
			payload.append = append
			payload.baseLen = prev.length
			payload.fullResync = false
		} else {
			payload.content = content
			payload.fullResync = true
		}

		this.lastPostedContent = content
		panel.notifyAgentWritePartial(payload)
	}

	async execute(params: WriteSpecParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult, askApproval } = callbacks
		const streamId = this.streamId ?? `ws-final-${Date.now()}`

		// Tool request received — log args summary (content length only; full body can be large).
		logWriteSpec("info", "request received", {
			title: typeof params.title === "string" ? params.title : params.title,
			spec_id: params.spec_id === undefined ? "(omitted)" : params.spec_id,
			doc: params.doc,
			mode: params.mode ?? "(default replace)",
			contentType: typeof params.content,
			contentLength: typeof params.content === "string" ? params.content.length : null,
			hasOldString: typeof params.old_string === "string" && params.old_string.length > 0,
			hasNewString: typeof params.new_string === "string",
			section_heading: params.section_heading ?? null,
			replace_all: params.replace_all ?? null,
		})

		try {
			// Problem A defensive guard: a non-string doc (object/array received
			// from broken gateways) must not crash on `.trim()`. Coerce cleanly
			// so the actionable "doc is required" error surfaces instead of an
			// opaque "Object has no method trim" TypeError that this catch would
			// otherwise mishandle as a generic final-failure message.
			const docRaw = params.doc
			const doc =
				typeof docRaw === "string"
					? docRaw.trim()
					: typeof docRaw === "number" || typeof docRaw === "boolean"
						? String(docRaw).trim()
						: ""
			if (!doc) {
				task.consecutiveMistakeCount++
				task.didToolFailInCurrentTurn = true
				const reason = "doc is required (e.g. requirements, design, tasks)"
				logWriteSpec("warn", "validation failed", { reason })
				this.abortStream(task, streamId, null, "requirements", "doc is required")
				pushToolResult(formatResponse.toolError(reason))
				this.resetStreamState()
				return
			}

			const writeMode = normalizeWriteSpecMode(params.mode)
			const isSearch = writeMode === "search_replace"
			if (!isSearch && typeof params.content !== "string") {
				task.consecutiveMistakeCount++
				task.didToolFailInCurrentTurn = true
				const reason = `content is required for mode "${writeMode}". For tiny edits use mode "search_replace" with old_string/new_string instead of rewriting the whole doc.`
				logWriteSpec("warn", "validation failed", { reason, writeMode, contentType: typeof params.content })
				this.abortStream(task, streamId, null, doc, "content is required")
				pushToolResult(formatResponse.toolError(reason))
				this.resetStreamState()
				return
			}
			if (isSearch && (typeof params.old_string !== "string" || !params.old_string.length)) {
				task.consecutiveMistakeCount++
				task.didToolFailInCurrentTurn = true
				const reason =
					'mode search_replace requires non-empty old_string and new_string. Example: {"mode":"search_replace","old_string":"- [ ] Task","new_string":"- [x] Task","spec_id":"<id>","doc":"tasks","title":null,"content":null}'
				logWriteSpec("warn", "validation failed", { reason: "old_string required for search_replace" })
				this.abortStream(task, streamId, null, doc, "old_string required")
				pushToolResult(formatResponse.toolError(reason))
				this.resetStreamState()
				return
			}

			const workspaceRoot = getSpecWorkspaceRoot(task)
			const service = getSpecServiceForTask(task)
			logWriteSpec("info", "SpecService resolved", { workspaceRoot })

			// F-006b: reject display-only truncated ids from environment_details (e.g. "9b09f722…")
			if (isTruncatedDisplaySpecId(params.spec_id)) {
				task.consecutiveMistakeCount++
				task.didToolFailInCurrentTurn = true
				const raw = String(params.spec_id)
				const reason = truncatedSpecIdErrorMessage(raw)
				logWriteSpec("warn", "validation failed", { reason: "truncated display spec_id", raw })
				this.abortStream(task, streamId, null, doc, "truncated display spec_id")
				pushToolResult(formatResponse.toolError(reason))
				this.resetStreamState()
				return
			}

			// F-005e / F-022c: null/sentinel → prefer UPDATE active/last-opened/sole pack when
			// title is empty, matches, or mode is partial. CREATE when title is non-empty and
			// distinct from the resolved pack (sole or multi with last-opened) on full replace —
			// this is the agent path for "import existing markdown as a new Spec Workspace".
			let specId = coerceOptionalSpecId(params.spec_id) ?? ""
			let created = false
			const titleForCreate = typeof params.title === "string" ? params.title.trim() : ""

			if (!specId) {
				const existingId = await resolveExistingSpecIdSoft(task, service, workspaceRoot, null)
				let useExisting = false
				if (existingId) {
					const meta = await service.getWorkspace(workspaceRoot, existingId)
					const list = await service.listWorkspaces(workspaceRoot)
					const isPartial =
						writeMode === "search_replace" || writeMode === "append" || writeMode === "upsert_section"
					// Title matches active/resolved pack (or empty title) → update.
					// Distinct non-empty title + full replace → create new pack (import/create-from-md).
					const titleMatchesExisting = Boolean(meta && titleForCreate && titleForCreate === meta.title)
					const titleEmpty = !titleForCreate
					const distinctTitleReplace =
						Boolean(titleForCreate) && !titleMatchesExisting && writeMode === "replace" && !isPartial

					if (isPartial || titleEmpty || titleMatchesExisting) {
						useExisting = true
						specId = existingId
					} else if (distinctTitleReplace) {
						if (list.length === 1) {
							// Sole pack + distinct title: rename the existing pack instead of
							// creating a new one. The user intends to rename, not duplicate.
							useExisting = true
							specId = existingId
							logWriteSpec("info", "rename path chosen (sole pack + distinct title)", {
								titleForCreate,
								resolvedExistingId: existingId,
								resolvedExistingTitle: meta?.title ?? null,
							})
						} else {
							// Multiple packs + distinct title + replace → create new pack
							// (import existing markdown as a new Spec Workspace).
							useExisting = false
							logWriteSpec("info", "create path chosen (distinct title + replace)", {
								titleForCreate,
								resolvedExistingId: existingId,
								resolvedExistingTitle: meta?.title ?? null,
								packCount: list.length,
								writeMode,
							})
						}
					} else {
						// Fallback: partial-ish or ambiguous → prefer update
						useExisting = true
						specId = existingId
					}
				}

				logWriteSpec("info", "soft-resolve result", {
					existingId,
					useExisting,
					titleForCreate: titleForCreate || "(empty)",
					writeMode,
				})

				if (!useExisting && titleForCreate) {
					const approvalCreate = await askApproval(
						"tool",
						JSON.stringify({
							tool: "write_spec",
							action: "create",
							title: titleForCreate,
							doc,
							mode: writeMode,
						}),
					)
					if (!approvalCreate) {
						logWriteSpec("warn", "user denied create", { title: titleForCreate, doc })
						this.abortStream(task, streamId, null, doc, "user denied create")
						pushToolResult(formatResponse.toolDenied())
						this.resetStreamState()
						return
					}
					const ws = await service.createWorkspace({ title: titleForCreate, workspaceRoot })
					specId = ws.id
					created = true
					logWriteSpec("info", "SpecService.createWorkspace ok", {
						specId,
						title: titleForCreate,
						doc,
					})
				} else if (!useExisting) {
					const existing = await service.listWorkspaces(workspaceRoot)
					task.consecutiveMistakeCount++
					task.didToolFailInCurrentTurn = true
					if (existing.length === 0) {
						const reason =
							'No specs exist and title is empty. CREATE: {"title":"My Spec","spec_id":null,"doc":"design","content":"# Design\\n","mode":"replace"}. Never use write_to_file for plans. Never create+copy+delete an existing pack.'
						logWriteSpec("error", "final failure", { reason: "no specs and empty title" })
						this.abortStream(task, streamId, null, doc, "no specs and empty title")
						pushToolResult(formatResponse.toolError(reason))
					} else {
						const available = existing.map((e) => `${e.id} (${e.title})`).join("; ")
						const reason =
							`Multiple specs exist and no active/last-opened pack is set, so this call cannot choose a pack. ` +
							`Update: pass full spec_id from list_specs (or open the pack in Spec Workspace). ` +
							`Create a NEW pack when the user asks for a new/separate spec: non-empty title + spec_id: null. ` +
							`Do not create a duplicate pack to work around missing document kinds — missing requirements/design/tasks are created inside the same pack on write. ` +
							`Do not fall back to write_to_file / project Markdown for planning docs. Available: ${available}`
						logWriteSpec("error", "final failure", {
							reason: "multiple specs, empty title, no last-opened",
							availableCount: existing.length,
						})
						this.abortStream(task, streamId, null, doc, "multiple specs, empty title")
						pushToolResult(formatResponse.toolError(reason))
					}
					this.resetStreamState()
					return
				}
			} else {
				const meta = await service.getWorkspace(workspaceRoot, specId)
				if (!meta) {
					task.consecutiveMistakeCount++
					task.didToolFailInCurrentTurn = true
					const looksLikeSentinel = /^(null|none|undefined|nil)$/i.test(specId)
					const reason = looksLikeSentinel
						? `Invalid spec_id "${specId}" (looks like a null sentinel). Use JSON null to update the active pack or CREATE with a non-empty title when no pack exists.`
						: `Spec not found: ${specId}. UPDATE: real id from list_specs or spec_id null for active pack. CREATE only when user wants a new pack: title + spec_id null. Missing doc kinds are auto-created inside the same pack — do not create+copy+delete.`
					logWriteSpec("error", "final failure", {
						reason: looksLikeSentinel ? "spec_id sentinel" : "spec not found",
						specId,
					})
					this.abortStream(task, streamId, specId, doc, `Spec not found: ${specId}`)
					pushToolResult(formatResponse.toolError(reason))
					this.resetStreamState()
					return
				}
				logWriteSpec("info", "explicit spec_id resolved", { specId, title: meta.title })
			}

			// Load existing body for merge modes; replace uses content only
			let existingContent = ""
			if (writeMode !== "replace" || !created) {
				const existingDoc = await service.getDocument(workspaceRoot, specId, doc)
				existingContent = existingDoc?.content ?? ""
			}

			let finalContent: string
			try {
				// Issue #6: batch replacements take priority over single search_replace
				if (Array.isArray(params.replacements) && params.replacements.length > 0) {
					const contentBase = created && writeMode === "replace" ? "" : existingContent
					finalContent = applyBatchSearchReplace(contentBase, params.replacements)
				} else {
					finalContent = resolveWriteBody({
						mode: writeMode,
						existingContent: created && writeMode === "replace" ? "" : existingContent,
						content: typeof params.content === "string" ? params.content : undefined,
						sectionHeading: params.section_heading ?? undefined,
						oldString: params.old_string ?? undefined,
						newString: params.new_string ?? undefined,
						replaceAll: params.replace_all === true,
					})
				}
			} catch (mergeErr) {
				task.consecutiveMistakeCount++
				task.didToolFailInCurrentTurn = true
				const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr)
				logWriteSpec("error", "final failure", { reason: "merge failed", message: msg, writeMode, specId })
				this.abortStream(task, streamId, specId, doc, msg)
				pushToolResult(formatResponse.toolError(msg))
				this.resetStreamState()
				return
			}

			// Issue #5: dry_run — preview changes without applying
			if (params.dry_run === true) {
				const preview =
					finalContent.length > 2000 ? finalContent.slice(0, 2000) + "\n...(truncated)" : finalContent
				task.consecutiveMistakeCount = 0
				pushToolResult(
					JSON.stringify(
						{
							ok: true,
							dry_run: true,
							specId,
							doc,
							mode: writeMode,
							existingLength: existingContent.length,
							resultLength: finalContent.length,
							wouldChange: finalContent !== existingContent,
							preview,
						},
						null,
						2,
					),
				)
				this.resetStreamState()
				return
			}

			if (!created) {
				const didApprove = await askApproval(
					"tool",
					JSON.stringify({
						tool: "write_spec",
						action: writeMode === "replace" ? "write" : writeMode,
						specId,
						doc,
						mode: writeMode,
						contentLength: finalContent.length,
					}),
				)
				if (!didApprove) {
					logWriteSpec("warn", "user denied write", { specId, doc, writeMode })
					this.abortStream(task, streamId, specId, doc, "user denied write")
					pushToolResult(formatResponse.toolDenied())
					this.resetStreamState()
					return
				}
			}

			const updated = await service.writeDocument({
				specId,
				workspaceRoot,
				docIdOrKind: doc,
				content: finalContent,
			})
			logWriteSpec("info", "SpecService.writeDocument ok", {
				specId,
				doc: updated.kind,
				revision: updated.revision,
				created,
				writeMode,
				contentLength: finalContent.length,
			})

			// Rename workspace title AFTER document write so search_replace/merge
			// operates on pre-rename content (old headings still present for matching).
			// The rename then auto-syncs document headings to the new title.
			if (titleForCreate && !created) {
				try {
					const currentMeta = await service.getWorkspace(workspaceRoot, specId)
					if (currentMeta && titleForCreate !== currentMeta.title) {
						const approvalRename = await askApproval(
							"tool",
							JSON.stringify({
								tool: "write_spec",
								action: "rename",
								specId,
								oldTitle: currentMeta.title,
								newTitle: titleForCreate,
							}),
						)
						if (approvalRename) {
							await service.renameWorkspace(workspaceRoot, specId, titleForCreate)
							logWriteSpec("info", "workspace renamed", {
								specId,
								oldTitle: currentMeta.title,
								newTitle: titleForCreate,
							})
						} else {
							logWriteSpec("warn", "user denied rename", {
								specId,
								oldTitle: currentMeta.title,
								newTitle: titleForCreate,
							})
						}
					}
				} catch (renameErr) {
					// Non-fatal: rename failure should not block the write result
					logWriteSpec("warn", "rename failed (continuing with write)", {
						message: renameErr instanceof Error ? renameErr.message : String(renameErr),
					})
				}
			}

			// F-020: the finalize notification is the ONLY signal that releases the
			// webview from streaming mode. If it is lost, the panel wedges with
			// agentStreaming=true and every subsequent document push (including the
			// Refresh path) is silently dropped — the exact "content only appears
			// after close-reopen" field bug. It must therefore NEVER be suppressed
			// by failures in best-effort side operations (listWorkspaces,
			// saveLastOpened): post it FIRST, with entries attached opportunistically.
			let entries: unknown[] | undefined
			try {
				entries = await service.listWorkspaces(workspaceRoot)
			} catch (entriesError) {
				// Best-effort only — the card list can refresh on the next event; the
				// finalize signal itself must still be delivered.
				logWriteSpec("warn", "listWorkspaces failed during finalize notify (continuing)", {
					message: entriesError instanceof Error ? entriesError.message : String(entriesError),
				})
			}
			try {
				const panel = SpecWorkspacePanel.getCurrent() ?? this.ensurePanel(task)
				panel?.notifyAgentWriteFinalized({
					streamId,
					specId,
					title: titleForCreate || this.streamTitle || updated.title,
					docKind: updated.kind,
					mode: created ? "create" : "update",
					content: finalContent,
					revision: updated.revision,
					entries,
				})
			} catch (notifyError) {
				logWriteSpec("warn", "notifyAgentWriteFinalized failed", {
					message: notifyError instanceof Error ? notifyError.message : String(notifyError),
				})
			}

			// Best-effort UI state — must not affect the write result or the notify.
			try {
				const provider = task.providerRef.deref()
				if (provider?.context?.workspaceState) {
					const hash = hashWorkspaceRoot(workspaceRoot)
					await saveLastOpened(provider.context.workspaceState, hash, {
						specId,
						docKind: doc,
						workspaceRoot,
						updatedAt: Date.now(),
					})
				}
			} catch {
				// UI state persistence is non-critical.
			}

			invalidateSpecContextCache(task.taskId)
			task.consecutiveMistakeCount = 0
			logWriteSpec("info", "success", {
				created,
				specId,
				doc: updated.kind,
				revision: updated.revision,
				writeMode,
			})
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						created,
						specId,
						mode: writeMode,
						doc: {
							id: updated.id,
							kind: updated.kind,
							title: updated.title,
							revision: updated.revision,
							updatedAt: updated.updatedAt,
						},
						contentLength: finalContent.length,
						message:
							writeMode === "search_replace"
								? "Spec patched (search_replace) in extension storage — not a full rewrite."
								: writeMode === "append" || writeMode === "upsert_section"
									? `Spec updated with mode ${writeMode} (server merged with existing body).`
									: "Virtual spec fully replaced in extension storage. Spec Workspace UI updates when open.",
					},
					null,
					2,
				),
			)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			logWriteSpec("error", "final failure", { reason: "unhandled exception", message })
			this.abortStream(task, streamId, this.streamSpecId, this.streamDocKind || "requirements", message)
			await handleError("writing spec", error as Error)
			pushToolResult(formatResponse.toolError(message))
		} finally {
			this.resetStreamState()
		}
	}

	/**
	 * F-020b: accept known doc kinds on first sight; unknown still needs two identical partials.
	 */
	private isDocReady(doc: string | undefined): boolean {
		if (!doc || !String(doc).trim()) {
			this.lastSeenDoc = doc
			return false
		}
		const trimmed = String(doc).trim().toLowerCase()
		if (KNOWN_DOC_KINDS.has(trimmed)) {
			this.lastSeenDoc = doc
			return true
		}
		const stabilized = this.lastSeenDoc !== undefined && this.lastSeenDoc === doc
		this.lastSeenDoc = doc
		return stabilized
	}

	private ensurePanel(task: Task): SpecWorkspacePanel | undefined {
		const existing = SpecWorkspacePanel.getCurrent()
		if (existing) {
			return existing
		}
		const provider = task.providerRef.deref()
		if (!provider?.contextProxy?.globalStorageUri?.fsPath || !provider.context) {
			return undefined
		}
		try {
			return SpecWorkspacePanel.ensureOpenForAgent({
				context: provider.context,
				globalStoragePath: provider.contextProxy.globalStorageUri.fsPath,
				getWorkspaceRoot: () => task.cwd,
			})
		} catch {
			return undefined
		}
	}

	private abortStream(task: Task, streamId: string, specId: string | null, docKind: string, reason: string): void {
		const panel = SpecWorkspacePanel.getCurrent()
		panel?.notifyAgentWriteAborted({
			streamId,
			specId,
			docKind,
			reason,
		})
	}

	private resetStreamState(): void {
		if (this.coalesceTimer) {
			clearTimeout(this.coalesceTimer)
			this.coalesceTimer = null
		}
		this.streamId = null
		this.lastPartialPostAt = 0
		this.lastPostedContent = ""
		this.pendingContent = null
		this.lastSeenDoc = undefined
		this.lastSeenTitle = undefined
		this.streamMode = "update"
		this.streamSpecId = null
		this.streamDocKind = null
		this.streamTitle = null
		this.streamStarted = false
		this.resetPartialState()
	}
}

export const writeSpecTool = new WriteSpecTool()
