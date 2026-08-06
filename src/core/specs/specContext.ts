/**
 * F-006 — Compact Spec Workspace summary for environment_details (agent memory).
 * Index/meta only — never dumps full markdown bodies.
 */

import type { Task } from "../task/Task"
import { SpecService } from "./SpecService"
import { hashWorkspaceRoot } from "./paths"
import { loadLastOpened } from "./ui/specUiState"
import type { SpecWorkspace, SpecWorkspaceIndexEntry } from "./types"

export const SPEC_CONTEXT_MAX_PACKS = 8
export const SPEC_CONTEXT_MAX_CHARS = 2000
/** Short TTL so multiple env_details calls in one turn share one list. */
const CACHE_TTL_MS = 3000

interface CacheEntry {
	text: string
	expiresAt: number
	workspaceRootHash: string
}

const cacheByTask = new Map<string, CacheEntry>()

/** Call after successful write_spec / UI save so the next env_details is fresh. */
export function invalidateSpecContextCache(taskId?: string): void {
	if (taskId) {
		cacheByTask.delete(taskId)
		return
	}
	cacheByTask.clear()
}

/**
 * Build a compact SPEC WORKSPACE block for the model.
 * Safe to call when specs storage is missing — returns empty string or a short "none" note.
 */
export async function getSpecContextSection(cline: Task): Promise<string> {
	const cwd = cline.cwd
	if (!cwd?.trim()) {
		return ""
	}

	const provider = cline.providerRef.deref()
	const globalStorage = provider?.contextProxy?.globalStorageUri?.fsPath
	if (!globalStorage) {
		return ""
	}

	let workspaceRootHash: string
	try {
		workspaceRootHash = hashWorkspaceRoot(cwd)
	} catch {
		return ""
	}

	const taskId = cline.taskId ?? "unknown"
	const now = Date.now()
	const cached = cacheByTask.get(taskId)
	if (cached && cached.workspaceRootHash === workspaceRootHash && cached.expiresAt > now) {
		return cached.text
	}

	try {
		const service = new SpecService(globalStorage)
		const entries = await service.listWorkspaces(cwd)
		const last = provider?.context?.workspaceState
			? loadLastOpened(provider.context.workspaceState, workspaceRootHash)
			: undefined

		const text = await formatSpecContextBlock({
			service,
			cwd,
			entries,
			lastOpenedSpecId: last?.specId,
			lastOpenedDocKind: last?.docKind,
			maxPacks: SPEC_CONTEXT_MAX_PACKS,
			maxChars: SPEC_CONTEXT_MAX_CHARS,
		})

		cacheByTask.set(taskId, {
			text,
			expiresAt: now + CACHE_TTL_MS,
			workspaceRootHash,
		})
		return text
	} catch {
		// Spec storage optional — never break environment_details
		return ""
	}
}

export async function formatSpecContextBlock(params: {
	service: SpecService
	cwd: string
	entries: SpecWorkspaceIndexEntry[]
	lastOpenedSpecId?: string
	lastOpenedDocKind?: string
	maxPacks?: number
	maxChars?: number
}): Promise<string> {
	const {
		service,
		cwd,
		entries,
		lastOpenedSpecId,
		lastOpenedDocKind,
		maxPacks = SPEC_CONTEXT_MAX_PACKS,
		maxChars = SPEC_CONTEXT_MAX_CHARS,
	} = params

	const lines: string[] = []
	lines.push("# Spec Workspace (virtual — not project files)")
	lines.push(
		"Index only (titles/stages/revs). Display prefixes like 9b09f722… are NOT valid tool spec_id values — never pass them to read_spec/write_spec. " +
			"Active pack: prefer spec_id: null (tool resolves last-opened/single pack). Specific pack: list_specs → full id from tool result only. " +
			"Use read_spec before large replace; use write_spec modes append/upsert_section/search_replace for partial updates.",
	)

	if (!entries.length) {
		lines.push("Packs: (none). Create with write_spec title + spec_id: null.")
		return lines.join("\n")
	}

	// Sort by updatedAt desc
	const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt)

	// Active: last-opened if still present, else sole pack, else most recent
	let activeId = lastOpenedSpecId
	if (activeId && !sorted.some((e) => e.id === activeId)) {
		activeId = undefined
	}
	if (!activeId && sorted.length === 1) {
		activeId = sorted[0].id
	}
	if (!activeId && sorted.length > 0) {
		activeId = sorted[0].id
	}

	// Load meta for packs we will display (active first, then recent)
	const orderedIds: string[] = []
	if (activeId) {
		orderedIds.push(activeId)
	}
	for (const e of sorted) {
		if (e.id !== activeId) {
			orderedIds.push(e.id)
		}
	}

	const toShow = orderedIds.slice(0, maxPacks)
	const omitted = Math.max(0, orderedIds.length - toShow.length)

	// Active line — never emit bare id=<truncated> as a tool-looking parameter
	if (activeId) {
		const entry = sorted.find((e) => e.id === activeId)
		const meta = await service.getWorkspace(cwd, activeId)
		const activeTitle = meta?.title ?? entry?.title ?? activeId
		const stage = meta?.stage ?? entry?.stage ?? "?"
		const lastDoc = lastOpenedDocKind && activeId === lastOpenedSpecId ? lastOpenedDocKind : undefined
		const revHint = meta ? formatDocsRevisions(meta) : ""
		const prefix = displayPrefix(activeId)
		lines.push(
			`Active: "${activeTitle}" (stage=${stage}${lastDoc ? `, lastDoc=${lastDoc}` : ""}${revHint ? `, ${revHint}` : ""})` +
				(prefix ? `; display_prefix=${prefix} (NOT a tool spec_id — use spec_id: null for Active)` : ""),
		)
	}

	lines.push(`Packs (${entries.length}${omitted ? `, showing ${toShow.length}` : ""}):`)

	for (const id of toShow) {
		const entry = sorted.find((e) => e.id === id)
		const meta = await service.getWorkspace(cwd, id)
		const title = meta?.title ?? entry?.title ?? id
		const stage = meta?.stage ?? entry?.stage ?? "?"
		const updated = entry?.updatedAt ?? meta?.updatedAt
		const updatedStr = updated ? formatDay(updated) : "?"
		const docs = meta ? formatDocsRevisions(meta) : "docs: (meta unavailable)"
		const marker = id === activeId ? " *" : ""
		const prefix = displayPrefix(id)
		// Title-first; optional display_prefix only (never "id=…" tool shape)
		lines.push(
			`- "${title}" | ${stage} | updated=${updatedStr} | ${docs}` +
				(prefix ? ` | display_prefix=${prefix} (not tool id)` : "") +
				marker,
		)
	}

	if (omitted > 0) {
		lines.push(`(+${omitted} more — call list_specs for full list)`)
	}

	let text = lines.join("\n")
	if (text.length > maxChars) {
		text = text.slice(0, maxChars - 24) + "\n…(truncated; use list_specs)"
	}
	return text
}

/** Compact display-only prefix; never a valid tool parameter when abbreviated. */
function displayPrefix(id: string): string | null {
	if (!id || id.length <= 12) {
		// Short enough to show full value only as display_prefix with disclaimer, still not encouraged as copy-paste
		return null
	}
	return id.slice(0, 8) + "…"
}

function formatDay(ts: number): string {
	try {
		return new Date(ts).toISOString().slice(0, 10)
	} catch {
		return "?"
	}
}

function formatDocsRevisions(meta: SpecWorkspace): string {
	const parts = meta.docs.map((d) => `${d.kind}@r${d.revision}`)
	return `docs: ${parts.join(", ")}`
}
