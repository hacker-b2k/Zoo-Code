import { describe, expect, it } from "vitest"

import { PerTaskToolRetryGuards, ToolRetryGuard } from "../ToolRetryGuard"

const call = (name = "apply_diff") => ({
	type: "tool_use" as const,
	name: name as any,
	params: {},
	nativeArgs: { path: "src/a.ts" },
	partial: false,
})

describe("ToolRetryGuard", () => {
	it("allows the first malformed payload and blocks the identical retry", () => {
		const guard = new ToolRetryGuard({ limit: 1 })
		expect(guard.check(call()).action).toBe("allow")
		expect(guard.check(call()).action).toBe("block")
		expect(guard.check(call()).reason).toContain("Identical apply_diff call")
	})

	it("resets when payload changes", () => {
		const guard = new ToolRetryGuard({ limit: 1 })
		expect(guard.check(call()).action).toBe("allow")
		expect(guard.check(call()).action).toBe("block")
		const changed = call()
		changed.nativeArgs = { path: "src/b.ts" }
		expect(guard.check(changed).action).toBe("allow")
	})

	it("isolates concurrent tasks/scopes", () => {
		const guards = new PerTaskToolRetryGuards(1)
		expect(guards.check("task-a", call()).action).toBe("allow")
		expect(guards.check("task-b", call()).action).toBe("allow")
		expect(guards.check("task-a", call()).action).toBe("block")
	})
})
