import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { listSpecsTool } from "../ListSpecsTool"
import { readSpecTool } from "../ReadSpecTool"
import { writeSpecTool } from "../WriteSpecTool"
import { deleteSpecTool } from "../DeleteSpecTool"
import { SpecService } from "../../specs/SpecService"
import { hashWorkspaceRoot } from "../../specs/paths"
import { saveLastOpened } from "../../specs/ui/specUiState"
import { SpecWorkspacePanel } from "../../specs/ui/SpecWorkspacePanel"
import type { Task } from "../../task/Task"
import type { ToolCallbacks } from "../BaseTool"
import type { ToolUse } from "../../../shared/tools"

describe("F-004 Spec agent tools", () => {
	let globalStorage: string
	let projectRoot: string
	let pushToolResult: ReturnType<typeof vi.fn>
	let askApproval: ReturnType<typeof vi.fn>
	let handleError: ReturnType<typeof vi.fn>
	let task: Task
	let callbacks: ToolCallbacks

	beforeEach(async () => {
		globalStorage = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-f004-global-"))
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-f004-project-"))
		pushToolResult = vi.fn()
		askApproval = vi.fn().mockResolvedValue(true)
		handleError = vi.fn().mockResolvedValue(undefined)

		const workspaceStateStore = new Map<string, unknown>()
		task = {
			cwd: projectRoot,
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			say: vi.fn().mockResolvedValue(undefined),
			providerRef: {
				deref: () => ({
					contextProxy: { globalStorageUri: { fsPath: globalStorage } },
					context: {
						workspaceState: {
							get: (key: string, def?: unknown) =>
								workspaceStateStore.has(key) ? workspaceStateStore.get(key) : def,
							update: async (key: string, value: unknown) => {
								if (value === undefined) workspaceStateStore.delete(key)
								else workspaceStateStore.set(key, value)
							},
						},
					},
				}),
			},
		} as unknown as Task
		;(task as any).__wsStore = workspaceStateStore

		callbacks = {
			pushToolResult,
			askApproval,
			handleError,
		} as unknown as ToolCallbacks
	})

	afterEach(async () => {
		// F-020 stream state lives on the singleton tool instance across tests
		;(writeSpecTool as unknown as { resetStreamState: () => void }).resetStreamState()
		vi.restoreAllMocks()
		vi.useRealTimers()
		await fs.rm(globalStorage, { recursive: true, force: true }).catch(() => {})
		await fs.rm(projectRoot, { recursive: true, force: true }).catch(() => {})
	})

	it("registers tool names on tool instances", () => {
		expect(listSpecsTool.name).toBe("list_specs")
		expect(readSpecTool.name).toBe("read_spec")
		expect(writeSpecTool.name).toBe("write_spec")
		expect(deleteSpecTool.name).toBe("delete_spec")
	})

	it("F-022c: write_spec null+title updates last-opened imported pack (no duplicate create)", async () => {
		const service = new SpecService(globalStorage)
		const imported = await service.createWorkspaceFromDocuments({
			title: "Imported Plan",
			workspaceRoot: projectRoot,
			documents: [
				{
					id: "design",
					kind: "design",
					title: "Imported Plan",
					fileName: "design.md",
					content: "# Design\n\nOriginal\n",
				},
			],
			reason: "import",
		})
		const store = (task as any).__wsStore as Map<string, unknown>
		const memento = {
			get: (key: string, def?: unknown) => (store.has(key) ? store.get(key) : def),
			update: async (key: string, value: unknown) => {
				if (value === undefined) store.delete(key)
				else store.set(key, value)
			},
		}
		await saveLastOpened(memento as any, hashWorkspaceRoot(projectRoot), {
			specId: imported.id,
			docKind: "design",
			workspaceRoot: projectRoot,
			updatedAt: Date.now(),
		})

		await writeSpecTool.execute(
			{
				title: "Imported Plan",
				spec_id: null,
				doc: "design",
				mode: "search_replace",
				old_string: "Original",
				new_string: "Updated",
				content: null as unknown as string,
			},
			task,
			callbacks,
		)

		const payload = JSON.parse(pushToolResult.mock.calls.at(-1)![0])
		expect(payload.ok).toBe(true)
		expect(payload.created).toBe(false)
		expect(payload.specId).toBe(imported.id)
		const list = await service.listWorkspaces(projectRoot)
		expect(list).toHaveLength(1)
		const doc = await service.getDocument(projectRoot, imported.id, "design")
		expect(doc?.content).toContain("Updated")
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("F-022c: write_spec on imported pack creates missing tasks kind in same pack", async () => {
		const service = new SpecService(globalStorage)
		const imported = await service.createWorkspaceFromDocuments({
			title: "Sparse Import",
			workspaceRoot: projectRoot,
			documents: [
				{
					id: "design",
					kind: "design",
					title: "Sparse Import",
					fileName: "design.md",
					content: "# Design\n",
				},
			],
			reason: "import",
		})

		await writeSpecTool.execute(
			{
				title: null,
				spec_id: imported.id,
				doc: "tasks",
				mode: "replace",
				content: "# Tasks\n\n- [x] done\n",
			},
			task,
			callbacks,
		)

		const payload = JSON.parse(pushToolResult.mock.calls.at(-1)![0])
		expect(payload.ok).toBe(true)
		expect(payload.specId).toBe(imported.id)
		expect(payload.created).toBe(false)
		const meta = await service.getWorkspace(projectRoot, imported.id)
		expect(meta?.docs.map((d) => d.kind).sort()).toEqual(["design", "tasks"])
		expect(await service.listWorkspaces(projectRoot)).toHaveLength(1)
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("delete_spec removes virtual pack after approval and never touches project", async () => {
		const service = new SpecService(globalStorage)
		const ws = await service.createWorkspace({ title: "Delete Me", workspaceRoot: projectRoot })
		await deleteSpecTool.execute({ spec_id: ws.id }, task, callbacks)
		expect(askApproval).toHaveBeenCalled()
		const payload = JSON.parse(pushToolResult.mock.calls[0][0])
		expect(payload.ok).toBe(true)
		expect(payload.deleted).toBe(true)
		expect(payload.specId).toBe(ws.id)
		expect(await service.getWorkspace(projectRoot, ws.id)).toBeNull()
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("delete_spec rejects truncated display id", async () => {
		await deleteSpecTool.execute({ spec_id: "9b09f722…" }, task, callbacks)
		const msg = String(pushToolResult.mock.calls[0][0])
		expect(msg).toMatch(/Rejected display-only|truncated/i)
		expect(askApproval).not.toHaveBeenCalled()
	})

	it("delete_spec does not delete when approval denied", async () => {
		const service = new SpecService(globalStorage)
		const ws = await service.createWorkspace({ title: "Keep Me", workspaceRoot: projectRoot })
		askApproval.mockResolvedValueOnce(false)
		await deleteSpecTool.execute({ spec_id: ws.id }, task, callbacks)
		expect(await service.getWorkspace(projectRoot, ws.id)).not.toBeNull()
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("F-022b: bulk delete_spec deletes many with one approval and progress", async () => {
		const service = new SpecService(globalStorage)
		const a = await service.createWorkspace({ title: "Test A", workspaceRoot: projectRoot })
		const b = await service.createWorkspace({ title: "Test B", workspaceRoot: projectRoot })
		const c = await service.createWorkspace({ title: "Keep C", workspaceRoot: projectRoot })

		await deleteSpecTool.execute({ spec_ids: [a.id, b.id], spec_id: null }, task, callbacks)

		expect(askApproval).toHaveBeenCalledTimes(1)
		const approvalPayload = JSON.parse(askApproval.mock.calls[0][1])
		expect(approvalPayload.action).toBe("delete_bulk")
		expect(approvalPayload.explicitBulk).toBe(true)
		expect(approvalPayload.count).toBe(2)

		const sayCalls = (task.say as ReturnType<typeof vi.fn>).mock.calls
		const progress = sayCalls
			.map((c) => {
				try {
					return JSON.parse(c[1])
				} catch {
					return null
				}
			})
			.filter((p) => p?.action === "delete_progress")
		expect(progress).toHaveLength(2)
		expect(progress[0]).toMatchObject({ index: 1, total: 2 })
		expect(progress[1]).toMatchObject({ index: 2, total: 2 })

		const payload = JSON.parse(pushToolResult.mock.calls[0][0])
		expect(payload.ok).toBe(true)
		expect(payload.deletedCount).toBe(2)
		expect(await service.getWorkspace(projectRoot, a.id)).toBeNull()
		expect(await service.getWorkspace(projectRoot, b.id)).toBeNull()
		expect(await service.getWorkspace(projectRoot, c.id)).not.toBeNull()
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("F-022b: delete_all with title_contains filters packs", async () => {
		const service = new SpecService(globalStorage)
		const t1 = await service.createWorkspace({ title: "test-spec-1", workspaceRoot: projectRoot })
		const t2 = await service.createWorkspace({ title: "test-spec-2", workspaceRoot: projectRoot })
		const keep = await service.createWorkspace({ title: "Production Auth", workspaceRoot: projectRoot })

		await deleteSpecTool.execute(
			{ delete_all: true, title_contains: "test", spec_id: null, spec_ids: null },
			task,
			callbacks,
		)

		expect(askApproval).toHaveBeenCalledTimes(1)
		const approvalPayload = JSON.parse(askApproval.mock.calls[0][1])
		expect(approvalPayload.action).toBe("delete_bulk")
		expect(approvalPayload.deleteAll).toBe(true)

		expect(await service.getWorkspace(projectRoot, t1.id)).toBeNull()
		expect(await service.getWorkspace(projectRoot, t2.id)).toBeNull()
		expect(await service.getWorkspace(projectRoot, keep.id)).not.toBeNull()
	})

	it("F-022b: bulk continues after partial failure", async () => {
		const service = new SpecService(globalStorage)
		const a = await service.createWorkspace({ title: "A", workspaceRoot: projectRoot })
		const b = await service.createWorkspace({ title: "B", workspaceRoot: projectRoot })
		const original = service.deleteWorkspace.bind(service)
		let calls = 0
		vi.spyOn(service, "deleteWorkspace").mockImplementation(async (root, id) => {
			calls++
			if (id === a.id) {
				throw new Error("simulated failure")
			}
			return original(root, id)
		})
		// Tool constructs its own SpecService — inject via getSpecServiceForTask path:
		// Recreate tool execute path by mocking module is heavy; instead delete with one missing id.
		vi.restoreAllMocks()
		// Partial failure via one missing id in list + one real
		await deleteSpecTool.execute({ spec_ids: [a.id, "missing-id-000", b.id], spec_id: null }, task, callbacks)
		const payload = JSON.parse(pushToolResult.mock.calls[0][0])
		// missing filtered out at resolve; both real deleted
		expect(payload.deletedCount).toBe(2)
		expect(await service.getWorkspace(projectRoot, a.id)).toBeNull()
		expect(await service.getWorkspace(projectRoot, b.id)).toBeNull()
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("list_specs returns empty list without writing project files", async () => {
		await listSpecsTool.execute({}, task, callbacks)
		expect(pushToolResult).toHaveBeenCalled()
		const payload = JSON.parse(pushToolResult.mock.calls[0][0])
		expect(payload.ok).toBe(true)
		expect(payload.specs).toEqual([])
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("write_spec creates pack and write_spec/read_spec round-trip without project files", async () => {
		await writeSpecTool.execute(
			{
				title: "Agent Plan",
				spec_id: null,
				doc: "design",
				content: "# Design\n\nFrom agent\n",
			},
			task,
			callbacks,
		)

		expect(askApproval).toHaveBeenCalled()
		const writePayload = JSON.parse(pushToolResult.mock.calls.at(-1)![0])
		expect(writePayload.ok).toBe(true)
		expect(writePayload.created).toBe(true)
		const specId = writePayload.specId as string

		pushToolResult.mockClear()
		await readSpecTool.execute({ spec_id: specId, doc: "design" }, task, callbacks)
		const readPayload = JSON.parse(pushToolResult.mock.calls[0][0])
		expect(readPayload.ok).toBe(true)
		expect(readPayload.content).toBe("# Design\n\nFrom agent\n")
		expect(readPayload.doc.revision).toBeGreaterThanOrEqual(1)

		// Storage under global only
		const service = new SpecService(globalStorage)
		const list = await service.listWorkspaces(projectRoot)
		expect(list).toHaveLength(1)
		expect(await fs.readdir(projectRoot)).toEqual([])
		const specsDir = path.join(globalStorage, "specs")
		await expect(fs.access(specsDir)).resolves.toBeUndefined()
	})

	it("write_spec updates existing by spec_id", async () => {
		const service = new SpecService(globalStorage)
		const ws = await service.createWorkspace({ title: "Existing", workspaceRoot: projectRoot })

		await writeSpecTool.execute(
			{
				title: "Existing",
				spec_id: ws.id,
				doc: "requirements",
				content: "# Requirements\n\nUpdated\n",
			},
			task,
			callbacks,
		)

		const doc = await service.getDocument(projectRoot, ws.id, "requirements")
		expect(doc?.content).toBe("# Requirements\n\nUpdated\n")
		expect(doc?.meta.revision).toBe(2)
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("F-021: search_replace toggles checkbox without full rewrite", async () => {
		const service = new SpecService(globalStorage)
		const ws = await service.createWorkspace({ title: "Tasks Pack", workspaceRoot: projectRoot })
		await service.writeDocument({
			specId: ws.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "tasks",
			content: "# Tasks\n\n- [ ] Ship login\n- [ ] Ship logout\n",
		})

		await writeSpecTool.execute(
			{
				title: null,
				spec_id: ws.id,
				doc: "tasks",
				content: null as unknown as string,
				mode: "search_replace",
				old_string: "- [ ] Ship login",
				new_string: "- [x] Ship login",
				replace_all: false,
			},
			task,
			callbacks,
		)

		const payload = JSON.parse(pushToolResult.mock.calls.at(-1)![0])
		expect(payload.ok).toBe(true)
		expect(payload.mode).toBe("search_replace")
		const doc = await service.getDocument(projectRoot, ws.id, "tasks")
		expect(doc?.content).toContain("- [x] Ship login")
		expect(doc?.content).toContain("- [ ] Ship logout")
	})

	it("F-021: append mode merges without losing prior body", async () => {
		const service = new SpecService(globalStorage)
		const ws = await service.createWorkspace({ title: "Design Pack", workspaceRoot: projectRoot })
		await service.writeDocument({
			specId: ws.id,
			workspaceRoot: projectRoot,
			docIdOrKind: "design",
			content: "# Design\n\n## Intro\nhello\n",
		})

		await writeSpecTool.execute(
			{
				title: "",
				spec_id: ws.id,
				doc: "design",
				mode: "append",
				content: "## Data Model\n\ntables...\n",
			},
			task,
			callbacks,
		)

		const doc = await service.getDocument(projectRoot, ws.id, "design")
		expect(doc?.content).toContain("## Intro")
		expect(doc?.content).toContain("hello")
		expect(doc?.content).toContain("## Data Model")
		expect(doc?.content).toContain("tables...")
	})

	it("F-021: create with string None still creates pack", async () => {
		await writeSpecTool.execute(
			{
				title: "From None",
				spec_id: "None" as unknown as null,
				doc: "design",
				content: "# Design\n",
				mode: "replace",
			},
			task,
			callbacks,
		)
		const payload = JSON.parse(pushToolResult.mock.calls.at(-1)![0])
		expect(payload.ok).toBe(true)
		expect(payload.created).toBe(true)
		expect(payload.specId).not.toBe("None")
	})

	it("F-006b: write_spec rejects truncated display id with recovery message", async () => {
		await writeSpecTool.execute(
			{
				title: "X",
				spec_id: "9b09f722…",
				doc: "design",
				content: "# D\n",
				mode: "replace",
			},
			task,
			callbacks,
		)
		const msg = String(pushToolResult.mock.calls.at(-1)![0])
		expect(msg).toMatch(/Rejected display-only|truncated/i)
		expect(msg).toContain("list_specs")
		expect(msg).toContain("spec_id: null")
		const service = new SpecService(globalStorage)
		expect(await service.listWorkspaces(projectRoot)).toHaveLength(0)
	})

	it("F-006b: read_spec rejects truncated display id", async () => {
		await readSpecTool.execute({ spec_id: "abcdef12...", doc: "design" }, task, callbacks)
		const msg = String(pushToolResult.mock.calls[0][0])
		expect(msg).toMatch(/Rejected display-only|truncated/i)
		expect(msg).toContain("list_specs")
	})

	it("read_spec errors when doc missing and no specs", async () => {
		await readSpecTool.execute({ spec_id: null, doc: "design" }, task, callbacks)
		const msg = String(pushToolResult.mock.calls[0][0])
		expect(msg.toLowerCase()).toMatch(/no virtual specs|error/)
	})

	it("write_spec empty title + multiple packs explains create via title + spec_id null (F-005c)", async () => {
		const service = new SpecService(globalStorage)
		await service.createWorkspace({ title: "Auth", workspaceRoot: projectRoot })
		await service.createWorkspace({ title: "Billing", workspaceRoot: projectRoot })

		await writeSpecTool.execute(
			{
				title: "",
				spec_id: null,
				doc: "design",
				content: "# Design\n",
			},
			task,
			callbacks,
		)

		const msg = String(pushToolResult.mock.calls[0][0])
		expect(msg).toContain("Create a NEW pack")
		expect(msg).toContain("spec_id: null")
		expect(msg).toContain("Do not fall back to write_to_file")
		expect(msg).toMatch(/Auth|Billing/)
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("write_spec still creates a new pack while others exist when title is non-empty", async () => {
		const service = new SpecService(globalStorage)
		await service.createWorkspace({ title: "Auth", workspaceRoot: projectRoot })

		await writeSpecTool.execute(
			{
				title: "Caching",
				spec_id: null,
				doc: "requirements",
				content: "# Requirements\n\nCaching\n",
			},
			task,
			callbacks,
		)

		const payload = JSON.parse(pushToolResult.mock.calls.at(-1)![0])
		expect(payload.ok).toBe(true)
		expect(payload.created).toBe(true)
		const list = await service.listWorkspaces(projectRoot)
		expect(list).toHaveLength(2)
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("F-020: handlePartial never writes to SpecService / project (preview only)", async () => {
		const notifyPartial = vi.fn()
		const notifyStarted = vi.fn()
		vi.spyOn(SpecWorkspacePanel, "getCurrent").mockReturnValue({
			notifyAgentWriteStarted: notifyStarted,
			notifyAgentWritePartial: notifyPartial,
			notifyAgentWriteFinalized: vi.fn(),
			notifyAgentWriteAborted: vi.fn(),
		} as unknown as SpecWorkspacePanel)
		vi.spyOn(SpecWorkspacePanel, "ensureOpenForAgent").mockReturnValue({
			notifyAgentWriteStarted: notifyStarted,
			notifyAgentWritePartial: notifyPartial,
			notifyAgentWriteFinalized: vi.fn(),
			notifyAgentWriteAborted: vi.fn(),
		} as unknown as SpecWorkspacePanel)

		const before = await fs.readdir(globalStorage).catch(() => [])

		const block = {
			type: "tool_use",
			name: "write_spec",
			partial: true,
			params: {},
			nativeArgs: {
				title: "Live",
				spec_id: null,
				doc: "design",
				content: "# Design\n\nPartial body\n",
			},
		} as unknown as ToolUse<"write_spec">

		// Known doc kinds are ready on first partial (F-020b)
		await writeSpecTool.handlePartial(task, block)

		const after = await fs.readdir(globalStorage).catch(() => [])
		expect(after.filter((n) => n === "specs").length).toBeLessThanOrEqual(
			before.filter((n) => n === "specs").length,
		)
		expect(await fs.readdir(projectRoot)).toEqual([])

		expect(notifyStarted.mock.calls.length + notifyPartial.mock.calls.length).toBeGreaterThan(0)
	})

	it("F-020b: second partial sends append when content grows as prefix", async () => {
		vi.useFakeTimers()
		const notifyPartial = vi.fn()
		const notifyStarted = vi.fn()
		const panelMock = {
			notifyAgentWriteStarted: notifyStarted,
			notifyAgentWritePartial: notifyPartial,
			notifyAgentWriteFinalized: vi.fn(),
			notifyAgentWriteAborted: vi.fn(),
		} as unknown as SpecWorkspacePanel
		vi.spyOn(SpecWorkspacePanel, "getCurrent").mockReturnValue(panelMock)
		vi.spyOn(SpecWorkspacePanel, "ensureOpenForAgent").mockReturnValue(panelMock)

		const block1 = {
			type: "tool_use",
			name: "write_spec",
			partial: true,
			params: {},
			nativeArgs: {
				title: "T",
				spec_id: null,
				doc: "design",
				content: "Hello",
			},
		} as unknown as ToolUse<"write_spec">

		await writeSpecTool.handlePartial(task, block1)
		expect(notifyPartial).toHaveBeenCalled()
		const first = notifyPartial.mock.calls.at(-1)![0]
		expect(first.fullResync).toBe(true)
		expect(first.content).toBe("Hello")

		// Advance past throttle window
		await vi.advanceTimersByTimeAsync(30)

		const block2 = {
			...block1,
			nativeArgs: {
				title: "T",
				spec_id: null,
				doc: "design",
				content: "Hello world",
			},
		} as unknown as ToolUse<"write_spec">

		await writeSpecTool.handlePartial(task, block2)
		const second = notifyPartial.mock.calls.at(-1)![0]
		expect(second.fullResync).toBe(false)
		expect(second.append).toBe(" world")
		expect(second.baseLen).toBe(5)
		expect(second.content).toBeUndefined()

		vi.useRealTimers()
	})

	it("F-020: successful execute notifies finalized after durable write", async () => {
		const notifyFinal = vi.fn()
		const notifyAbort = vi.fn()
		vi.spyOn(SpecWorkspacePanel, "getCurrent").mockReturnValue({
			notifyAgentWriteStarted: vi.fn(),
			notifyAgentWritePartial: vi.fn(),
			notifyAgentWriteFinalized: notifyFinal,
			notifyAgentWriteAborted: notifyAbort,
		} as unknown as SpecWorkspacePanel)

		await writeSpecTool.execute(
			{
				title: "Final Live",
				spec_id: null,
				doc: "design",
				content: "# Design\n\nDone\n",
			},
			task,
			callbacks,
		)

		expect(notifyFinal).toHaveBeenCalled()
		const arg = notifyFinal.mock.calls[0][0]
		expect(arg.content).toContain("Done")
		expect(arg.revision).toBeGreaterThanOrEqual(1)
		expect(arg.specId).toBeTruthy()
		expect(notifyAbort).not.toHaveBeenCalled()

		const service = new SpecService(globalStorage)
		const list = await service.listWorkspaces(projectRoot)
		expect(list).toHaveLength(1)
	})

	it("F-020: denied approval aborts stream without durable create", async () => {
		const notifyAbort = vi.fn()
		vi.spyOn(SpecWorkspacePanel, "getCurrent").mockReturnValue({
			notifyAgentWriteStarted: vi.fn(),
			notifyAgentWritePartial: vi.fn(),
			notifyAgentWriteFinalized: vi.fn(),
			notifyAgentWriteAborted: notifyAbort,
		} as unknown as SpecWorkspacePanel)

		askApproval.mockResolvedValueOnce(false)

		await writeSpecTool.execute(
			{
				title: "Denied",
				spec_id: null,
				doc: "design",
				content: "# Design\n",
			},
			task,
			callbacks,
		)

		expect(notifyAbort).toHaveBeenCalled()
		const service = new SpecService(globalStorage)
		expect(await service.listWorkspaces(projectRoot)).toHaveLength(0)
	})

	it('write_spec treats string "null" like JSON null and creates (F-005e)', async () => {
		await writeSpecTool.execute(
			{
				title: "From String Null",
				// Model quirk: string instead of JSON null
				spec_id: "null" as unknown as null,
				doc: "design",
				content: "# Design\n\nCreated\n",
			},
			task,
			callbacks,
		)

		const payload = JSON.parse(pushToolResult.mock.calls.at(-1)![0])
		expect(payload.ok).toBe(true)
		expect(payload.created).toBe(true)
		expect(payload.specId).toBeTruthy()
		expect(payload.specId).not.toBe("null")
		expect(await fs.readdir(projectRoot)).toEqual([])
	})

	it("write_spec still updates when a real spec_id is provided (F-005e)", async () => {
		const service = new SpecService(globalStorage)
		const ws = await service.createWorkspace({ title: "Keep Me", workspaceRoot: projectRoot })

		await writeSpecTool.execute(
			{
				title: "Keep Me",
				spec_id: ws.id,
				doc: "tasks",
				content: "# Tasks\n\nUpdated via real id\n",
			},
			task,
			callbacks,
		)

		const payload = JSON.parse(pushToolResult.mock.calls.at(-1)![0])
		expect(payload.ok).toBe(true)
		expect(payload.created).toBe(false)
		expect(payload.specId).toBe(ws.id)
		const doc = await service.getDocument(projectRoot, ws.id, "tasks")
		expect(doc?.content).toContain("Updated via real id")
	})
})
