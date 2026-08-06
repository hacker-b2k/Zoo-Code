import type * as vscode from "vscode"

/**
 * Persist last-opened Spec Workspace selection for restore after restart (F-002 / light F-003).
 * Keys are scoped by workspace root hash so multi-folder setups do not collide.
 */

export const SPEC_UI_STATE_KEY_PREFIX = "zoo.specs.ui.lastOpened."

export interface SpecUiLastOpened {
	specId: string
	docKind: string
	workspaceRoot: string
	updatedAt: number
}

export function lastOpenedStateKey(workspaceRootHash: string): string {
	return `${SPEC_UI_STATE_KEY_PREFIX}${workspaceRootHash}`
}

export async function saveLastOpened(
	workspaceState: vscode.Memento,
	workspaceRootHash: string,
	state: SpecUiLastOpened,
): Promise<void> {
	await workspaceState.update(lastOpenedStateKey(workspaceRootHash), state)
}

export function loadLastOpened(
	workspaceState: vscode.Memento,
	workspaceRootHash: string,
): SpecUiLastOpened | undefined {
	return workspaceState.get<SpecUiLastOpened>(lastOpenedStateKey(workspaceRootHash))
}

export async function clearLastOpened(workspaceState: vscode.Memento, workspaceRootHash: string): Promise<void> {
	await workspaceState.update(lastOpenedStateKey(workspaceRootHash), undefined)
}
