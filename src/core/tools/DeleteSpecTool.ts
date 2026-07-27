import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { getSpecServiceForTask, getSpecWorkspaceRoot, resolveSpecId } from "../specs/getSpecServiceForTask"
import { hashWorkspaceRoot, isTruncatedDisplaySpecId, truncatedSpecIdErrorMessage } from "../specs/paths"
import { clearLastOpened, loadLastOpened } from "../specs/ui/specUiState"
import { invalidateSpecContextCache } from "../specs/specContext"
import { SpecWorkspacePanel } from "../specs/ui/SpecWorkspacePanel"
import type { SpecService } from "../specs/SpecService"

export interface DeleteSpecParams {
	/** Single pack id (legacy). null = active/last-opened. */
	spec_id?: string | null
	/** Bulk: explicit list of full pack ids from list_specs. */
	spec_ids?: string[] | null
	/**
	 * Explicit bulk: delete all packs in this workspace (optionally filtered by title_contains).
	 * Only when user intent is explicit ("delete all", "delete test specs").
	 */
	delete_all?: boolean | null
	/** Case-insensitive substring filter when delete_all is true (e.g. "test"). */
	title_contains?: string | null
}

interface ResolvedTarget {
	id: string
	title: string
}

/**
 * delete_spec — delete one or many virtual Spec packs (F-022 / F-022b).
 * Only extension globalStorage; never project files.
 * Single delete always requires approval.
 * Explicit bulk (spec_ids length>1, or delete_all) may auto-approve when master AA is on.
 * One approval covers the entire batch; progress reported as Deleting i/n.
 */
export class DeleteSpecTool extends BaseTool<"delete_spec"> {
	readonly name = "delete_spec" as const

	async execute(params: DeleteSpecParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			const workspaceRoot = getSpecWorkspaceRoot(task)
			const service = getSpecServiceForTask(task)

			const resolved = await this.resolveTargets(params, task, service, workspaceRoot, pushToolResult)
			if (!resolved) {
				return
			}
			const { targets, mode } = resolved
			if (!targets.length) {
				task.consecutiveMistakeCount++
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError("No matching virtual specs to delete. Call list_specs and check filters."),
				)
				return
			}

			const isExplicitBulk = mode === "bulk_ids" || mode === "delete_all"
			const action = isExplicitBulk ? "delete_bulk" : "delete"

			const approved = await askApproval(
				"tool",
				JSON.stringify({
					tool: "delete_spec",
					action,
					// F-022b: auto-approval only when explicit bulk + master AA
					explicitBulk: isExplicitBulk,
					count: targets.length,
					specId: targets.length === 1 ? targets[0].id : undefined,
					title: targets.length === 1 ? targets[0].title : undefined,
					titles: targets.slice(0, 20).map((t) => t.title),
					specIds: targets.map((t) => t.id),
					deleteAll: mode === "delete_all",
					titleContains: params.title_contains?.trim() || undefined,
				}),
			)
			if (!approved) {
				pushToolResult(formatResponse.toolError("User denied delete_spec"))
				return
			}

			const deleted: Array<{ id: string; title?: string }> = []
			const failed: Array<{ id: string; title?: string; error: string }> = []
			const total = targets.length

			for (let i = 0; i < targets.length; i++) {
				const target = targets[i]
				// Task Activity: "Deleting 1/20 specs"
				await task
					.say(
						"tool",
						JSON.stringify({
							tool: "delete_spec",
							action: "delete_progress",
							index: i + 1,
							total,
							specId: target.id,
							title: target.title,
						}),
					)
					.catch(() => undefined)

				try {
					const result = await service.deleteWorkspace(workspaceRoot, target.id)
					deleted.push({ id: result.id, title: result.title ?? target.title })
				} catch (error) {
					failed.push({
						id: target.id,
						title: target.title,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			invalidateSpecContextCache()

			const deletedIds = new Set(deleted.map((d) => d.id))
			const provider = task.providerRef.deref()
			if (provider?.context?.workspaceState) {
				const hash = hashWorkspaceRoot(workspaceRoot)
				const last = loadLastOpened(provider.context.workspaceState, hash)
				if (last?.specId && deletedIds.has(last.specId)) {
					await clearLastOpened(provider.context.workspaceState, hash)
				}
			}

			SpecWorkspacePanel.getCurrent()?.refreshList()

			task.consecutiveMistakeCount = 0
			const ok = failed.length === 0
			if (!ok) {
				task.didToolFailInCurrentTurn = true
			}

			// Single-delete response shape for compatibility
			if (targets.length === 1 && deleted.length === 1 && failed.length === 0) {
				pushToolResult(
					JSON.stringify(
						{
							ok: true,
							deleted: true,
							specId: deleted[0].id,
							title: deleted[0].title,
							count: 1,
							hint: "Virtual pack and revision history removed. Project files were not modified.",
						},
						null,
						2,
					),
				)
				return
			}

			pushToolResult(
				JSON.stringify(
					{
						ok,
						count: targets.length,
						deletedCount: deleted.length,
						failedCount: failed.length,
						deleted,
						failed,
						hint: "Virtual packs and revision history removed. Project files were not modified.",
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("deleting spec", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	private async resolveTargets(
		params: DeleteSpecParams,
		task: Task,
		service: SpecService,
		workspaceRoot: string,
		pushToolResult: (s: string) => void,
	): Promise<{ targets: ResolvedTarget[]; mode: "single" | "bulk_ids" | "delete_all" } | null> {
		const deleteAll = params.delete_all === true
		const rawIds = Array.isArray(params.spec_ids) ? params.spec_ids : null
		const titleFilter = typeof params.title_contains === "string" ? params.title_contains.trim() : ""

		// Explicit bulk by ids
		if (rawIds && rawIds.length > 0) {
			const targets: ResolvedTarget[] = []
			const seen = new Set<string>()
			const missing: string[] = []
			for (const raw of rawIds) {
				if (isTruncatedDisplaySpecId(raw)) {
					task.consecutiveMistakeCount++
					task.didToolFailInCurrentTurn = true
					pushToolResult(formatResponse.toolError(truncatedSpecIdErrorMessage(String(raw))))
					return null
				}
				const id = typeof raw === "string" ? raw.trim() : ""
				if (!id || seen.has(id)) continue
				seen.add(id)
				const meta = await service.getWorkspace(workspaceRoot, id)
				if (meta) {
					targets.push({ id: meta.id, title: meta.title })
				} else {
					missing.push(id)
				}
			}
			if (!targets.length && missing.length) {
				task.consecutiveMistakeCount++
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`None of the provided spec_ids were found (${missing.length} missing). Call list_specs.`,
					),
				)
				return null
			}
			// Multiple ids (or single id via array) → bulk_ids when length > 1
			const mode = targets.length > 1 ? "bulk_ids" : "single"
			return { targets, mode }
		}

		// Explicit delete_all (optionally filtered)
		if (deleteAll) {
			const entries = await service.listWorkspaces(workspaceRoot)
			const filterLower = titleFilter.toLowerCase()
			const targets = entries
				.filter((e) => !filterLower || e.title.toLowerCase().includes(filterLower))
				.map((e) => ({ id: e.id, title: e.title }))
			return { targets, mode: "delete_all" }
		}

		// Legacy single: spec_id or null resolve
		if (isTruncatedDisplaySpecId(params.spec_id)) {
			task.consecutiveMistakeCount++
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError(truncatedSpecIdErrorMessage(String(params.spec_id))))
			return null
		}

		const specId = await resolveSpecId(task, service, workspaceRoot, params.spec_id)
		const meta = await service.getWorkspace(workspaceRoot, specId)
		if (!meta) {
			task.consecutiveMistakeCount++
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError(`Spec not found: ${specId}. Use list_specs or check doc kind.`))
			return null
		}
		return { targets: [{ id: meta.id, title: meta.title }], mode: "single" }
	}
}

export const deleteSpecTool = new DeleteSpecTool()
