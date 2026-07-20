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
