import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { getSpecServiceForTask, getSpecWorkspaceRoot } from "../specs/getSpecServiceForTask"

/**
 * list_specs — list virtual Spec Workspaces for the current project (F-004).
 * Never writes project files.
 */
export class ListSpecsTool extends BaseTool<"list_specs"> {
	readonly name = "list_specs" as const

	async execute(_params: Record<string, never>, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		try {
			const workspaceRoot = getSpecWorkspaceRoot(task)
			const service = getSpecServiceForTask(task)
			const entries = await service.listWorkspaces(workspaceRoot)

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						workspaceRoot,
						count: entries.length,
						specs: entries.map((e) => ({
							id: e.id,
							title: e.title,
							stage: e.stage,
							updatedAt: e.updatedAt,
						})),
						hint: "Use read_spec / write_spec with spec_id. Specs live in extension storage, not the project git tree.",
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("listing specs", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}
}

export const listSpecsTool = new ListSpecsTool()
