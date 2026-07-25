import { Task } from "../task/Task"
import { SpecService } from "./SpecService"
import { coerceOptionalSpecId, hashWorkspaceRoot } from "./paths"
import { loadLastOpened } from "./ui/specUiState"

/**
 * Resolve SpecService for a Task (F-004).
 * Storage is always extension globalStorage — never the project tree.
 */
export function getSpecServiceForTask(task: Task): SpecService {
	const provider = task.providerRef.deref()
	if (!provider) {
		throw new Error("Provider reference lost")
	}
	const globalStoragePath = provider.contextProxy.globalStorageUri.fsPath
	if (!globalStoragePath) {
		throw new Error("globalStoragePath is not available")
	}
	return new SpecService(globalStoragePath)
}

export function getSpecWorkspaceRoot(task: Task): string {
	const root = task.cwd
	if (!root || !String(root).trim()) {
		throw new Error("No workspace folder open (task.cwd is empty)")
	}
	return root
}

/**
 * Resolve which virtual spec to use when the agent omits spec_id.
 * Order: explicit id → last-opened (F-002 UI state) → single existing pack → error.
 */
export async function resolveSpecId(
	task: Task,
	service: SpecService,
	workspaceRoot: string,
	explicitSpecId?: string | null,
): Promise<string> {
	const trimmed = coerceOptionalSpecId(explicitSpecId)
	if (trimmed) {
		return trimmed
	}

	const soft = await resolveExistingSpecIdSoft(task, service, workspaceRoot, null)
	if (soft) {
		return soft
	}

	const list = await service.listWorkspaces(workspaceRoot)
	if (list.length === 0) {
		throw new Error(
			"No virtual specs exist for this workspace. Call write_spec with title to create one, or list_specs first.",
		)
	}
	throw new Error(
		`Multiple specs exist (${list.length}). Pass spec_id. Use list_specs to see ids: ${list.map((e) => e.id).join(", ")}`,
	)
}

/**
 * F-022c: non-throwing resolve for write_spec updates.
 * explicit → last-opened (valid) → sole pack → null (caller may create or error).
 */
export async function resolveExistingSpecIdSoft(
	task: Task,
	service: SpecService,
	workspaceRoot: string,
	explicitSpecId?: string | null,
): Promise<string | null> {
	const trimmed = coerceOptionalSpecId(explicitSpecId)
	if (trimmed) {
		const meta = await service.getWorkspace(workspaceRoot, trimmed)
		return meta ? trimmed : null
	}

	const provider = task.providerRef.deref()
	if (provider?.context?.workspaceState) {
		try {
			const hash = hashWorkspaceRoot(workspaceRoot)
			const last = loadLastOpened(provider.context.workspaceState, hash)
			if (last?.specId) {
				const meta = await service.getWorkspace(workspaceRoot, last.specId)
				if (meta) {
					return last.specId
				}
			}
		} catch {
			// ignore invalid last-opened
		}
	}

	const list = await service.listWorkspaces(workspaceRoot)
	if (list.length === 1) {
		return list[0].id
	}
	return null
}
