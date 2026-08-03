import { createHash, randomUUID } from "crypto"

import { SpecStore } from "./SpecStore"
import { sanitizeSpecContent } from "./sanitizeSpecContent"
import { specDocumentEvents } from "./specDocumentEvents"
import { specMutationLock } from "./specMutationLock"
import { assertSafeDocFileName, assertSafeId, hashWorkspaceRoot, normalizeWorkspaceRoot } from "./paths"
import { SpecTemplateService } from "./templates/SpecTemplateService"
import type { CreateSpecWorkspaceFromTemplateInput } from "./templates/templateTypes"
import {
	SPEC_SCHEMA_VERSION,
	STARTER_SPEC_DOCS,
	type CreateSpecWorkspaceFromDocumentsInput,
	type CreateSpecWorkspaceInput,
	type RestoreSpecDocumentRevisionInput,
	type SpecDocument,
	type SpecDocumentWithContent,
	type SpecDocKind,
	type SpecRevisionEntry,
	type SpecWorkspace,
	type SpecWorkspaceIndex,
	type SpecWorkspaceIndexEntry,
	type WriteSpecDocumentInput,
} from "./types"

/**
 * Public foundation API for Virtual Spec Documents (F-001).
 * Future tools (F-004) and UI (F-002) should call this service only.
 */
const MAX_DOCUMENT_REVISIONS = 50

export class SpecService {
	private readonly store: SpecStore
	/** Shared post-commit bus used by the panel and future virtual document providers. */
	readonly _eventBus = specDocumentEvents

	constructor(globalStoragePath: string) {
		if (!globalStoragePath || !globalStoragePath.trim()) {
			throw new Error("globalStoragePath is required")
		}
		this.store = new SpecStore(globalStoragePath)
	}

	hashWorkspaceRoot(workspaceRoot: string): string {
		return hashWorkspaceRoot(workspaceRoot)
	}

	async createWorkspace(input: CreateSpecWorkspaceInput): Promise<SpecWorkspace> {
		const title = input.title?.trim()
		if (!title) {
			throw new Error("title is required")
		}

		const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot)
		const workspaceRootHash = hashWorkspaceRoot(workspaceRoot)
		const now = Date.now()
		const specId = randomUUID()

		const docs: SpecDocument[] = STARTER_SPEC_DOCS.map((starter) => ({
			id: starter.kind,
			kind: starter.kind,
			title: starter.title,
			fileName: starter.fileName,
			revision: 1,
			createdAt: now,
			updatedAt: now,
		}))

		const workspace: SpecWorkspace = {
			id: specId,
			title,
			workspaceRootHash,
			workspaceRoot,
			stage: input.stage ?? "requirements",
			docs,
			taskIds: [],
			createdAt: now,
			updatedAt: now,
			schemaVersion: SPEC_SCHEMA_VERSION,
		}

		await this.store.writeMeta(workspace)

		for (const starter of STARTER_SPEC_DOCS) {
			await this.store.writeDocBody(workspaceRootHash, specId, starter.fileName, `# ${starter.title}\n`)
		}

		await this.upsertIndexEntry(workspaceRootHash, {
			id: workspace.id,
			title: workspace.title,
			stage: workspace.stage,
			updatedAt: workspace.updatedAt,
		})

		// Emit for every starter doc so event-driven subscribers (Spec Workspace
		// panel, virtual-doc provider) see the new pack immediately — previously
		// only createWorkspaceFromDocuments/Template emitted, so packs created via
		// write_spec/createSpec were invisible to the event bus until a doc write.
		for (const doc of workspace.docs) {
			this._eventBus.emitDocumentChanged({
				workspaceRootHash,
				specId,
				docId: doc.id,
				revision: doc.revision,
				reason: "initial",
			})
		}

		return workspace
	}

	async createWorkspaceFromDocuments(input: CreateSpecWorkspaceFromDocumentsInput): Promise<SpecWorkspace> {
		const title = input.title?.trim()
		if (!title) throw new Error("title is required")
		if (!Array.isArray(input.documents) || input.documents.length === 0) {
			throw new Error("At least one document is required")
		}
		const seenIds = new Set<string>()
		const seenFileNames = new Set<string>()
		for (const doc of input.documents) {
			assertSafeId(doc.id, "document id")
			assertSafeDocFileName(doc.fileName)
			if (!doc.title.trim()) throw new Error(`Document title is required: ${doc.id}`)
			if (typeof doc.content !== "string") throw new Error(`Document content must be a string: ${doc.id}`)
			if (seenIds.has(doc.id)) throw new Error(`Duplicate document id: ${doc.id}`)
			const foldedName = doc.fileName.toLowerCase()
			if (seenFileNames.has(foldedName)) throw new Error(`Duplicate document fileName: ${doc.fileName}`)
			seenIds.add(doc.id)
			seenFileNames.add(foldedName)
		}

		const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot)
		const workspaceRootHash = hashWorkspaceRoot(workspaceRoot)
		const now = Date.now()
		const specId = randomUUID()
		const workspace: SpecWorkspace = {
			id: specId,
			title,
			workspaceRootHash,
			workspaceRoot,
			stage: input.stage ?? "requirements",
			docs: input.documents.map((doc) => ({
				id: doc.id,
				kind: doc.kind,
				title: doc.title.trim(),
				fileName: doc.fileName,
				revision: 1,
				createdAt: now,
				updatedAt: now,
			})),
			taskIds: [],
			createdAt: now,
			updatedAt: now,
			schemaVersion: SPEC_SCHEMA_VERSION,
		}
		try {
			await this.store.writeMeta(workspace)
			for (const doc of input.documents) {
				await this.store.writeDocBody(workspaceRootHash, specId, doc.fileName, doc.content)
			}
			await this.upsertIndexEntry(workspaceRootHash, {
				id: workspace.id,
				title: workspace.title,
				stage: workspace.stage,
				updatedAt: workspace.updatedAt,
			})
			const reason = input.reason ?? "import"
			for (const doc of workspace.docs) {
				this._eventBus.emitDocumentChanged({
					workspaceRootHash,
					specId,
					docId: doc.id,
					revision: doc.revision,
					reason,
				})
			}
			return workspace
		} catch (error) {
			await this.store.deleteSpecDir(workspaceRootHash, specId).catch(() => undefined)
			throw error
		}
	}

	async createWorkspaceFromTemplate(input: CreateSpecWorkspaceFromTemplateInput): Promise<SpecWorkspace> {
		const template = new SpecTemplateService().expandTemplate(input.templateId, {
			title: input.title,
			date: input.date,
		})
		const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot)
		const workspaceRootHash = hashWorkspaceRoot(workspaceRoot)
		const now = Date.now()
		const specId = randomUUID()
		const workspace: SpecWorkspace = {
			id: specId,
			title: input.title.trim(),
			workspaceRootHash,
			workspaceRoot,
			stage: template.stage ?? "requirements",
			docs: template.documents.map((doc) => ({
				id: doc.id,
				kind: doc.kind,
				title: doc.title,
				fileName: doc.fileName,
				revision: 1,
				createdAt: now,
				updatedAt: now,
			})),
			taskIds: [],
			createdAt: now,
			updatedAt: now,
			schemaVersion: SPEC_SCHEMA_VERSION,
		}

		try {
			await this.store.writeMeta(workspace)
			for (const doc of template.documents) {
				await this.store.writeDocBody(workspaceRootHash, specId, doc.fileName, doc.content)
			}
			await this.upsertIndexEntry(workspaceRootHash, {
				id: workspace.id,
				title: workspace.title,
				stage: workspace.stage,
				updatedAt: workspace.updatedAt,
			})
			for (const doc of workspace.docs) {
				this._eventBus.emitDocumentChanged({
					workspaceRootHash,
					specId,
					docId: doc.id,
					revision: doc.revision,
					reason: "template",
				})
			}
			return workspace
		} catch (error) {
			await this.store.deleteSpecDir(workspaceRootHash, specId).catch(() => undefined)
			throw error
		}
	}

	async listWorkspaces(workspaceRoot: string): Promise<SpecWorkspaceIndexEntry[]> {
		const workspaceRootHash = hashWorkspaceRoot(workspaceRoot)
		let index = await this.store.readIndex(workspaceRootHash)
		if (!index) {
			index = await this.store.rebuildIndex(workspaceRootHash)
		}
		return index.entries
	}

	async getWorkspace(workspaceRoot: string, specId: string): Promise<SpecWorkspace | null> {
		assertSafeId(specId, "specId")
		const workspaceRootHash = hashWorkspaceRoot(workspaceRoot)
		return this.store.readMeta(workspaceRootHash, specId)
	}

	async getDocument(
		workspaceRoot: string,
		specId: string,
		docIdOrKind: string,
	): Promise<SpecDocumentWithContent | null> {
		assertSafeId(specId, "specId")
		const workspaceRootHash = hashWorkspaceRoot(workspaceRoot)
		const meta = await this.store.readMeta(workspaceRootHash, specId)
		if (!meta) {
			return null
		}

		const doc = findDoc(meta, docIdOrKind)
		if (!doc) {
			return null
		}

		const content = await this.store.readDocBody(workspaceRootHash, specId, doc.fileName)
		return { meta: doc, content }
	}

	async writeDocument(input: WriteSpecDocumentInput): Promise<SpecDocument> {
		assertSafeId(input.specId, "specId")
		if (typeof input.content !== "string") {
			throw new Error("content must be a string")
		}

		// Final sanitization boundary. Internal selection metadata (anchor ids,
		// selection_context envelopes) exists only to locate a fragment for the
		// model; it must never reach a stored document. Models sometimes echo it
		// back into content they author, so this is enforced here — the single
		// chokepoint every write passes through (agent write_spec, manual save,
		// import, merge) — rather than at any individual caller.
		const sanitized = sanitizeSpecContent(input.content)
		if (sanitized.removed) {
			console.warn(
				`[SpecService] Stripped internal selection metadata from content for spec ${input.specId}/${input.docIdOrKind}.`,
			)
		}
		input = { ...input, content: sanitized.content }

		const workspaceRootHash = hashWorkspaceRoot(input.workspaceRoot)
		// Pack-level lock so ensure-missing-doc + write stay atomic for concurrent kinds.
		const lockKey = `${workspaceRootHash}:${input.specId}`
		return specMutationLock.runExclusive(lockKey, async () => {
			const workspace = await this.store.readMeta(workspaceRootHash, input.specId)
			if (!workspace) {
				throw new Error(`Spec workspace not found: ${input.specId}`)
			}

			let doc = findDoc(workspace, input.docIdOrKind)
			if (!doc) {
				// F-022c: sparse packs (import) may lack requirements/design/tasks.
				// Ensure allowlisted kind inside the same pack — never force a new pack.
				doc = await this.ensureDocumentInWorkspace(workspaceRootHash, workspace, input.docIdOrKind)
			}
			if (input.expectedRevision !== undefined && input.expectedRevision !== doc.revision) {
				throw new Error(
					`Revision conflict for ${doc.id}: expected ${input.expectedRevision}, current ${doc.revision}`,
				)
			}

			const previousContent = await this.store.readDocBody(workspaceRootHash, input.specId, doc.fileName)
			let history = await this.store.readHistoryIndex(workspaceRootHash, input.specId, doc.id)
			if (!history.some((entry) => entry.revision === doc.revision)) {
				const initialEntry = revisionEntry(doc.revision, doc.updatedAt, previousContent, "initial")
				await this.store.writeRevisionSnapshot(
					workspaceRootHash,
					input.specId,
					doc.id,
					doc.revision,
					previousContent,
				)
				history.push(initialEntry)
			}

			const now = Date.now()
			const nextRevision = doc.revision + 1
			const reason = input.reason ?? "write"
			await this.store.writeDocBody(workspaceRootHash, input.specId, doc.fileName, input.content)
			await this.store.writeRevisionSnapshot(workspaceRootHash, input.specId, doc.id, nextRevision, input.content)
			history = history.filter((entry) => entry.revision !== nextRevision)
			history.push(revisionEntry(nextRevision, now, input.content, reason))
			history.sort((a, b) => a.revision - b.revision)
			while (history.length > MAX_DOCUMENT_REVISIONS) {
				const removed = history.shift()
				if (removed && removed.revision !== nextRevision) {
					await this.store.deleteRevisionSnapshot(workspaceRootHash, input.specId, doc.id, removed.revision)
				}
			}
			await this.store.writeHistoryIndex(workspaceRootHash, input.specId, doc.id, history)

			doc.revision = nextRevision
			doc.updatedAt = now
			if (input.title?.trim()) {
				doc.title = input.title.trim()
			}
			workspace.docs = workspace.docs.map((d) => (d.id === doc.id ? doc : d))
			workspace.updatedAt = now
			await this.store.writeMeta(workspace)
			await this.upsertIndexEntry(workspaceRootHash, {
				id: workspace.id,
				title: workspace.title,
				stage: workspace.stage,
				updatedAt: workspace.updatedAt,
			})

			this._eventBus.emitDocumentChanged({
				workspaceRootHash,
				specId: input.specId,
				docId: doc.id,
				revision: doc.revision,
				reason,
			})
			return { ...doc }
		})
	}

	/**
	 * F-022c: create a missing allowlisted document inside an existing pack.
	 * Mutates workspace.docs in memory and persists meta + empty body.
	 * Caller must hold the pack mutation lock.
	 */
	private async ensureDocumentInWorkspace(
		workspaceRootHash: string,
		workspace: SpecWorkspace,
		docIdOrKind: string,
	): Promise<SpecDocument> {
		const key = docIdOrKind.trim().toLowerCase()
		if (!key || !ENSUREABLE_DOC_KINDS.has(key as SpecDocKind)) {
			throw new Error(
				`Document not found: ${docIdOrKind}. Allowed kinds: requirements, design, tasks, notes, custom.`,
			)
		}
		const kind = key as SpecDocKind
		assertSafeId(kind, "document id")
		const fileName = `${kind}.md`
		assertSafeDocFileName(fileName)
		if (workspace.docs.some((d) => d.id === kind || d.fileName.toLowerCase() === fileName.toLowerCase())) {
			const existing = findDoc(workspace, kind)
			if (existing) return existing
			throw new Error(`Document slot conflict for ${kind}`)
		}

		const now = Date.now()
		const doc: SpecDocument = {
			id: kind,
			kind,
			title: titleForEnsuredKind(kind),
			fileName,
			revision: 1,
			createdAt: now,
			updatedAt: now,
		}
		await this.store.writeDocBody(workspaceRootHash, workspace.id, fileName, "")
		workspace.docs = [...workspace.docs, doc]
		workspace.updatedAt = now
		await this.store.writeMeta(workspace)
		await this.upsertIndexEntry(workspaceRootHash, {
			id: workspace.id,
			title: workspace.title,
			stage: workspace.stage,
			updatedAt: workspace.updatedAt,
		})
		this._eventBus.emitDocumentChanged({
			workspaceRootHash,
			specId: workspace.id,
			docId: doc.id,
			revision: doc.revision,
			reason: "write",
		})
		return doc
	}

	listDocumentRevisions = async (
		workspaceRoot: string,
		specId: string,
		docIdOrKind: string,
	): Promise<SpecRevisionEntry[]> => {
		assertSafeId(specId, "specId")
		const workspaceRootHash = hashWorkspaceRoot(workspaceRoot)
		const workspace = await this.store.readMeta(workspaceRootHash, specId)
		if (!workspace) throw new Error(`Spec workspace not found: ${specId}`)
		const doc = findDoc(workspace, docIdOrKind)
		if (!doc) throw new Error(`Document not found: ${docIdOrKind}`)
		const entries = await this.store.readHistoryIndex(workspaceRootHash, specId, doc.id)
		return entries.slice().sort((a, b) => a.revision - b.revision)
	}

	getDocumentRevision = async (
		workspaceRoot: string,
		specId: string,
		docIdOrKind: string,
		revision: number,
	): Promise<string> => {
		assertSafeId(specId, "specId")
		const workspaceRootHash = hashWorkspaceRoot(workspaceRoot)
		const workspace = await this.store.readMeta(workspaceRootHash, specId)
		if (!workspace) throw new Error(`Spec workspace not found: ${specId}`)
		const doc = findDoc(workspace, docIdOrKind)
		if (!doc) throw new Error(`Document not found: ${docIdOrKind}`)
		const content = await this.store.readRevisionSnapshot(workspaceRootHash, specId, doc.id, revision)
		if (content === null) throw new Error(`Revision not found: ${revision}`)
		return content
	}

	async restoreDocumentRevision(input: RestoreSpecDocumentRevisionInput): Promise<SpecDocument> {
		const content = await this.getDocumentRevision(
			input.workspaceRoot,
			input.specId,
			input.docIdOrKind,
			input.revision,
		)
		return this.writeDocument({
			specId: input.specId,
			workspaceRoot: input.workspaceRoot,
			docIdOrKind: input.docIdOrKind,
			content,
			expectedRevision: input.expectedCurrentRevision,
			reason: "restore",
		})
	}

	/**
	 * Delete a virtual pack (meta, docs, history) under global storage only.
	 * Never touches project files. Emits delete events for open zoo-spec tabs.
	 */
	async deleteWorkspace(
		workspaceRoot: string,
		specId: string,
	): Promise<{ deleted: boolean; id: string; title?: string }> {
		assertSafeId(specId, "specId")
		const root = normalizeWorkspaceRoot(workspaceRoot)
		const workspaceRootHash = hashWorkspaceRoot(root)
		const lockKey = `${workspaceRootHash}:${specId}`

		return specMutationLock.runExclusive(lockKey, async () => {
			const meta = await this.store.readMeta(workspaceRootHash, specId)
			const title = meta?.title
			const docs = meta?.docs ?? []

			// Notify virtual tabs before removal so providers can refresh to "unavailable"
			for (const doc of docs) {
				this._eventBus.emitDocumentChanged({
					workspaceRootHash,
					specId,
					docId: doc.id,
					revision: doc.revision,
					reason: "delete",
				})
			}

			await this.store.deleteSpecDir(workspaceRootHash, specId)

			const index = (await this.store.readIndex(workspaceRootHash)) ?? {
				version: 1 as const,
				workspaceRootHash,
				updatedAt: Date.now(),
				entries: [],
			}
			index.entries = index.entries.filter((e) => e.id !== specId)
			index.updatedAt = Date.now()
			await this.store.writeIndex(workspaceRootHash, index)

			// If meta was already gone, still ensure index is clean (idempotent)
			if (!meta && docs.length === 0) {
				this._eventBus.emitDocumentChanged({
					workspaceRootHash,
					specId,
					docId: "requirements",
					revision: 0,
					reason: "delete",
				})
			}

			return { deleted: true, id: specId, title }
		})
	}

	/**
	 * Rename a virtual spec pack — updates title in meta.json, index.json,
	 * and auto-syncs first heading in each document if it matches the old title.
	 */
	async renameWorkspace(workspaceRoot: string, specId: string, newTitle: string): Promise<SpecWorkspace> {
		assertSafeId(specId, "specId")
		const title = newTitle.trim()
		if (!title) {
			throw new Error("title is required")
		}

		const root = normalizeWorkspaceRoot(workspaceRoot)
		const workspaceRootHash = hashWorkspaceRoot(root)
		const lockKey = `${workspaceRootHash}:${specId}`

		return specMutationLock.runExclusive(lockKey, async () => {
			const workspace = await this.store.readMeta(workspaceRootHash, specId)
			if (!workspace) {
				throw new Error(`Spec workspace not found: ${specId}`)
			}

			if (workspace.title === title) {
				return { ...workspace } // no-op, title already matches
			}

			const oldTitle = workspace.title
			const now = Date.now()

			// Auto-sync first heading in each document if it contains the old title
			for (const doc of workspace.docs) {
				try {
					const content = await this.store.readDocBody(workspaceRootHash, specId, doc.fileName)
					if (!content) continue

					const lines = content.split("\n")
					let updated = false
					for (let i = 0; i < lines.length; i++) {
						const match = lines[i].match(/^(#{1,6})\s+(.+)$/)
						if (match) {
							const headingText = match[2].trim()
							const oldLower = oldTitle.toLowerCase()
							const headingLower = headingText.toLowerCase()
							// Pattern 1: Exact match — "Auth System"
							// Pattern 2: Prefix with separator — "Auth System - Requirements"
							// Pattern 3: Suffix with separator — "Requirements for Auth System"
							// Pattern 4: Contains (whole words) — "Auth System Requirements"
							const isExact = headingLower === oldLower
							const isPrefix =
								headingLower.startsWith(`${oldLower} -`) ||
								headingLower.startsWith(`${oldLower} —`) ||
								headingLower.startsWith(`${oldLower}:`)
							const isSuffix =
								headingLower.endsWith(` ${oldLower}`) || headingLower.endsWith(` for ${oldLower}`)
							const isContains = !isExact && !isPrefix && !isSuffix && headingLower.includes(oldLower)

							if (isExact) {
								lines[i] = `${match[1]} ${title}`
								updated = true
								break
							} else if (isPrefix) {
								const afterTitle = headingText.slice(oldTitle.length)
								lines[i] = `${match[1]} ${title}${afterTitle}`
								updated = true
								break
							} else if (isSuffix) {
								const idx = headingLower.lastIndexOf(oldLower)
								lines[i] = `${match[1]} ${headingText.slice(0, idx)}${title}`
								updated = true
								break
							} else if (isContains) {
								lines[i] =
									`${match[1]} ${headingText.replace(new RegExp(oldTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), title)}`
								updated = true
								break
							} else {
								// Pattern 5: Default starter heading — prepend new title
								// e.g. "# Design" → "# NewTitle — Design"
								const defaultHeadings = doc.kind ? [doc.kind, doc.title] : [doc.title]
								const isDefaultHeading = defaultHeadings.some((dh) => headingLower === dh.toLowerCase())
								if (isDefaultHeading && !headingLower.startsWith(title.toLowerCase())) {
									lines[i] = `${match[1]} ${title} — ${headingText}`
									updated = true
									break
								}
							}
							break // Stop at first heading regardless
						}
					}

					if (updated) {
						const newContent = lines.join("\n")
						await this.store.writeDocBody(workspaceRootHash, specId, doc.fileName, newContent)
						doc.revision += 1
						doc.updatedAt = now
						console.info(`[SpecService] Auto-synced heading in ${doc.fileName} for rename`)
					}
				} catch (docErr) {
					// Non-fatal: heading sync failure should not block the rename
					console.warn(`[SpecService] Failed to sync heading in ${doc.fileName}:`, docErr)
				}
			}

			workspace.title = title
			workspace.updatedAt = now
			await this.store.writeMeta(workspace)
			await this.upsertIndexEntry(workspaceRootHash, {
				id: workspace.id,
				title: workspace.title,
				stage: workspace.stage,
				updatedAt: workspace.updatedAt,
			})

			console.info(`[SpecService] Renamed spec ${specId}: "${oldTitle}" → "${title}"`)
			return { ...workspace }
		})
	}

	private async upsertIndexEntry(workspaceRootHash: string, entry: SpecWorkspaceIndexEntry): Promise<void> {
		const existing = await this.store.readIndex(workspaceRootHash)
		const index: SpecWorkspaceIndex = existing ?? {
			version: 1,
			workspaceRootHash,
			updatedAt: Date.now(),
			entries: [],
		}

		const without = index.entries.filter((e) => e.id !== entry.id)
		without.unshift(entry)
		without.sort((a, b) => b.updatedAt - a.updatedAt)
		index.entries = without
		index.updatedAt = Date.now()
		await this.store.writeIndex(workspaceRootHash, index)
	}
}

function revisionEntry(
	revision: number,
	createdAt: number,
	content: string,
	reason: SpecRevisionEntry["reason"],
): SpecRevisionEntry {
	return {
		revision,
		createdAt,
		contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
		byteLength: Buffer.byteLength(content, "utf8"),
		reason,
	}
}

/** Kinds that may be auto-created inside an existing pack on write (F-022c). */
const ENSUREABLE_DOC_KINDS = new Set<SpecDocKind>(["requirements", "design", "tasks", "notes", "custom"])

function findDoc(workspace: SpecWorkspace, docIdOrKind: string): SpecDocument | undefined {
	const key = docIdOrKind.trim()
	return workspace.docs.find((d) => d.id === key) ?? workspace.docs.find((d) => d.kind === (key as SpecDocKind))
}

function titleForEnsuredKind(kind: SpecDocKind): string {
	const starter = STARTER_SPEC_DOCS.find((s) => s.kind === kind)
	if (starter) return starter.title
	if (kind === "notes") return "Notes"
	if (kind === "custom") return "Custom"
	return kind.charAt(0).toUpperCase() + kind.slice(1)
}
