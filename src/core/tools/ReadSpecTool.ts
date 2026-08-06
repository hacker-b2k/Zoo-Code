import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { getSpecServiceForTask, getSpecWorkspaceRoot, resolveSpecId } from "../specs/getSpecServiceForTask"
import { isTruncatedDisplaySpecId, truncatedSpecIdErrorMessage } from "../specs/paths"
import { extractHeadings } from "../specs/specMerge"

interface ReadSpecParams {
	spec_id?: string | null
	doc: string
	/** "full" (default) | "headings" | "history" */
	mode?: string | null
	/** Specific revision number to read (mode must be "full" or omitted). */
	revision?: number | null
}

/**
 * read_spec — read a virtual Spec document (F-004).
 * Never touches the project tree.
 */
export class ReadSpecTool extends BaseTool<"read_spec"> {
	readonly name = "read_spec" as const

	async execute(params: ReadSpecParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		try {
			// Problem A defensive guard: a non-string doc (object/array/null)
			// would throw "Object has no method trim" inside the catch handler
			// below, surfacing a confusing TypeError instead of the actionable
			// "doc is required" message. Coerce cleanly first.
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
				pushToolResult(formatResponse.toolError("doc is required (e.g. requirements, design, tasks)"))
				return
			}

			const workspaceRoot = getSpecWorkspaceRoot(task)
			const service = getSpecServiceForTask(task)

			// F-006b: reject display-only truncated ids (e.g. "9b09f722…")
			if (isTruncatedDisplaySpecId(params.spec_id)) {
				task.consecutiveMistakeCount++
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(truncatedSpecIdErrorMessage(String(params.spec_id))))
				return
			}

			const specId = await resolveSpecId(task, service, workspaceRoot, params.spec_id)
			const readMode = typeof params.mode === "string" ? params.mode.trim().toLowerCase() : "full"

			// History mode: return revision list without full content
			if (readMode === "history") {
				try {
					const revisions = await service.listDocumentRevisions(workspaceRoot, specId, doc)
					task.consecutiveMistakeCount = 0
					pushToolResult(
						JSON.stringify(
							{
								ok: true,
								specId,
								doc,
								revisions: revisions.map((r) => ({
									revision: r.revision,
									createdAt: r.createdAt,
									byteLength: r.byteLength,
									reason: r.reason,
								})),
							},
							null,
							2,
						),
					)
				} catch (histErr) {
					const msg = histErr instanceof Error ? histErr.message : String(histErr)
					pushToolResult(formatResponse.toolError(`Failed to list revisions: ${msg}`))
				}
				return
			}

			// Specific revision mode
			if (typeof params.revision === "number" && params.revision > 0) {
				try {
					const revContent = await service.getDocumentRevision(workspaceRoot, specId, doc, params.revision)
					task.consecutiveMistakeCount = 0
					pushToolResult(
						JSON.stringify(
							{
								ok: true,
								specId,
								doc,
								revision: params.revision,
								content: revContent,
							},
							null,
							2,
						),
					)
				} catch (revErr) {
					const msg = revErr instanceof Error ? revErr.message : String(revErr)
					pushToolResult(formatResponse.toolError(`Failed to read revision: ${msg}`))
				}
				return
			}

			const result = await service.getDocument(workspaceRoot, specId, doc)
			if (!result) {
				task.consecutiveMistakeCount++
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Document not found: doc=${doc} spec_id=${specId}. Use list_specs or check doc kind (requirements|design|tasks).`,
					),
				)
				return
			}

			// Headings-only mode
			if (readMode === "headings") {
				task.consecutiveMistakeCount = 0
				pushToolResult(
					JSON.stringify(
						{
							ok: true,
							specId,
							doc: {
								id: result.meta.id,
								kind: result.meta.kind,
								title: result.meta.title,
								revision: result.meta.revision,
								updatedAt: result.meta.updatedAt,
							},
							headings: extractHeadings(result.content),
						},
						null,
						2,
					),
				)
				return
			}

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						specId,
						doc: {
							id: result.meta.id,
							kind: result.meta.kind,
							title: result.meta.title,
							revision: result.meta.revision,
							updatedAt: result.meta.updatedAt,
						},
						content: result.content,
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("reading spec", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}
}

export const readSpecTool = new ReadSpecTool()
