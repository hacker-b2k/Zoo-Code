import { checkAutoApproval } from "../index"

describe("checkAutoApproval — settings manage tools", () => {
	const base = {
		autoApprovalEnabled: true,
		alwaysAllowReadOnly: false,
		alwaysAllowWrite: false,
		alwaysAllowMcp: false,
		alwaysAllowModeSwitch: false,
		alwaysAllowSubtasks: false,
		alwaysAllowExecute: false,
		alwaysAllowFollowupQuestions: false,
	}

	it("asks when autoApprovalEnabled is false", async () => {
		const result = await checkAutoApproval({
			state: { ...base, autoApprovalEnabled: false, alwaysAllowWrite: true },
			ask: "tool",
			text: JSON.stringify({ tool: "manageProviderProfile", name: "p" }),
		})
		expect(result.decision).toBe("ask")
	})

	it("approves manageProviderProfile when alwaysAllowWrite", async () => {
		const result = await checkAutoApproval({
			state: { ...base, alwaysAllowWrite: true },
			ask: "tool",
			text: JSON.stringify({ tool: "manageProviderProfile", action: "upsert", name: "p" }),
		})
		expect(result.decision).toBe("approve")
	})

	it("asks for manageProviderProfile without alwaysAllowWrite", async () => {
		const result = await checkAutoApproval({
			state: { ...base },
			ask: "tool",
			text: JSON.stringify({ tool: "manageProviderProfile", name: "p" }),
		})
		expect(result.decision).toBe("ask")
	})

	it("approves setProviderSecret when alwaysAllowWrite", async () => {
		const result = await checkAutoApproval({
			state: { ...base, alwaysAllowWrite: true },
			ask: "tool",
			text: JSON.stringify({ tool: "setProviderSecret", name: "p", key: "openAiApiKey", operation: "set" }),
		})
		expect(result.decision).toBe("approve")
	})

	it("approves manageMcpServer when alwaysAllowMcp", async () => {
		const result = await checkAutoApproval({
			state: { ...base, alwaysAllowMcp: true },
			ask: "tool",
			text: JSON.stringify({ tool: "manageMcpServer", action: "admit", name: "s" }),
		})
		expect(result.decision).toBe("approve")
	})

	it("approves manageMcpServer when alwaysAllowWrite even without alwaysAllowMcp", async () => {
		const result = await checkAutoApproval({
			state: { ...base, alwaysAllowWrite: true },
			ask: "tool",
			text: JSON.stringify({ tool: "manageMcpServer", action: "admit", name: "s" }),
		})
		expect(result.decision).toBe("approve")
	})

	it("approves listMcpConfig when alwaysAllowReadOnly", async () => {
		const result = await checkAutoApproval({
			state: { ...base, alwaysAllowReadOnly: true },
			ask: "tool",
			text: JSON.stringify({ tool: "listMcpConfig", scope: "all" }),
		})
		expect(result.decision).toBe("approve")
	})

	it("approves listMcpConfig when alwaysAllowMcp", async () => {
		const result = await checkAutoApproval({
			state: { ...base, alwaysAllowMcp: true },
			ask: "tool",
			text: JSON.stringify({ tool: "listMcpConfig", scope: "all" }),
		})
		expect(result.decision).toBe("approve")
	})

	it("approves toggleMcpServer and setMcpSecret under alwaysAllowMcp", async () => {
		for (const tool of ["toggleMcpServer", "setMcpSecret", "deleteMcpServer"]) {
			const result = await checkAutoApproval({
				state: { ...base, alwaysAllowMcp: true },
				ask: "tool",
				text: JSON.stringify({ tool }),
			})
			expect(result.decision).toBe("approve")
		}
	})

	it("approves spawnWorker / listWorkers / collectResults when autoApprovalEnabled", async () => {
		for (const tool of ["spawnWorker", "listWorkers", "collectResults"]) {
			const result = await checkAutoApproval({
				state: { ...base, autoApprovalEnabled: true },
				ask: "tool",
				text: JSON.stringify({ tool }),
			})
			expect(result.decision).toBe("approve")
		}
	})

	it("asks for spawnWorker when autoApprovalEnabled is false", async () => {
		const result = await checkAutoApproval({
			state: { ...base, autoApprovalEnabled: false },
			ask: "tool",
			text: JSON.stringify({ tool: "spawnWorker", name: "w1" }),
		})
		expect(result.decision).toBe("ask")
	})
})

describe("checkAutoApproval — write_spec (F-005d)", () => {
	const base = {
		autoApprovalEnabled: true,
		alwaysAllowReadOnly: false,
		alwaysAllowWrite: false,
		alwaysAllowMcp: false,
		alwaysAllowModeSwitch: false,
		alwaysAllowSubtasks: false,
		alwaysAllowExecute: false,
		alwaysAllowFollowupQuestions: false,
	}

	it("approves write_spec create when autoApprovalEnabled (even without alwaysAllowWrite)", async () => {
		const result = await checkAutoApproval({
			state: { ...base, alwaysAllowWrite: false },
			ask: "tool",
			text: JSON.stringify({ tool: "write_spec", action: "create", title: "Auth", doc: "design" }),
		})
		expect(result.decision).toBe("approve")
	})

	it("approves write_spec write when autoApprovalEnabled", async () => {
		const result = await checkAutoApproval({
			state: { ...base },
			ask: "tool",
			text: JSON.stringify({ tool: "write_spec", action: "write", specId: "abc", doc: "requirements" }),
		})
		expect(result.decision).toBe("approve")
	})

	it("asks for write_spec when autoApprovalEnabled is false", async () => {
		const result = await checkAutoApproval({
			state: { ...base, autoApprovalEnabled: false, alwaysAllowWrite: true },
			ask: "tool",
			text: JSON.stringify({ tool: "write_spec", action: "create", title: "Auth", doc: "design" }),
		})
		expect(result.decision).toBe("ask")
	})

	it("still asks for project write tools without alwaysAllowWrite (unchanged)", async () => {
		const result = await checkAutoApproval({
			state: { ...base, alwaysAllowWrite: false },
			ask: "tool",
			text: JSON.stringify({ tool: "newFileCreated", path: "plans/x.md" }),
		})
		expect(result.decision).toBe("ask")
	})

	it("never auto-approves single delete_spec even when autoApprovalEnabled (F-022)", async () => {
		const result = await checkAutoApproval({
			state: { ...base, alwaysAllowWrite: true },
			ask: "tool",
			text: JSON.stringify({ tool: "delete_spec", action: "delete", specId: "abc", title: "X" }),
		})
		expect(result.decision).toBe("ask")
	})

	it("auto-approves explicit bulk delete_spec when master AA on (F-022b)", async () => {
		const result = await checkAutoApproval({
			state: { ...base },
			ask: "tool",
			text: JSON.stringify({
				tool: "delete_spec",
				action: "delete_bulk",
				explicitBulk: true,
				count: 5,
				specIds: ["a", "b"],
			}),
		})
		expect(result.decision).toBe("approve")
	})

	it("asks for bulk delete_spec when master AA is off (F-022b)", async () => {
		const result = await checkAutoApproval({
			state: { ...base, autoApprovalEnabled: false },
			ask: "tool",
			text: JSON.stringify({
				tool: "delete_spec",
				action: "delete_bulk",
				explicitBulk: true,
				count: 5,
			}),
		})
		expect(result.decision).toBe("ask")
	})

	it("asks for delete_spec bulk payload without explicitBulk flag", async () => {
		const result = await checkAutoApproval({
			state: { ...base },
			ask: "tool",
			text: JSON.stringify({
				tool: "delete_spec",
				action: "delete_bulk",
				explicitBulk: false,
				count: 3,
			}),
		})
		expect(result.decision).toBe("ask")
	})

	it("still approves project write tools only when alwaysAllowWrite", async () => {
		const denied = await checkAutoApproval({
			state: { ...base, alwaysAllowWrite: false },
			ask: "tool",
			text: JSON.stringify({ tool: "editedExistingFile", path: "src/a.ts" }),
		})
		expect(denied.decision).toBe("ask")

		const allowed = await checkAutoApproval({
			state: { ...base, alwaysAllowWrite: true },
			ask: "tool",
			text: JSON.stringify({ tool: "editedExistingFile", path: "src/a.ts" }),
		})
		expect(allowed.decision).toBe("approve")
	})
})
