import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { McpConfigStore } from "../mcpConfigStore"

describe("McpConfigStore", () => {
	let tmpDir: string
	let store: McpConfigStore

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-config-store-"))
		store = new McpConfigStore({
			resolvePath: async (scope) =>
				scope === "project"
					? path.join(tmpDir, "project", ".roo", "mcp.json")
					: path.join(tmpDir, "global", "mcp_settings.json"),
		})
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("ensure + read empty project file", async () => {
		const p = await store.ensure("project")
		expect(p).toContain(`${path.sep}mcp.json`)
		const doc = await store.read("project")
		expect(doc.mcpServers).toEqual({})
	})

	it("preserves top-level keys on write", async () => {
		const filePath = await store.ensure("global")
		await fs.writeFile(
			filePath,
			JSON.stringify({ mcpServers: {}, extra: { keep: true }, version: 2 }, null, 2),
			"utf-8",
		)
		await store.admitServer({
			name: "svc",
			config: { type: "stdio", command: "node", args: ["x.js"] },
			scope: "global",
			sourceKind: "marketplace",
			intent: "install_only",
		})
		const raw = JSON.parse(await fs.readFile(filePath, "utf-8"))
		expect(raw.extra).toEqual({ keep: true })
		expect(raw.version).toBe(2)
		expect(raw.mcpServers.svc.disabled).toBe(true)
	})

	it("admit install_only sets disabled true", async () => {
		const result = await store.admitServer({
			name: "github",
			config: { command: "npx", args: ["-y", "server"] },
			scope: "project",
			sourceKind: "marketplace",
		})
		expect(result.disabled).toBe(true)
		const doc = await store.read("project")
		expect(doc.mcpServers.github.disabled).toBe(true)
	})

	it("admit start sets disabled false", async () => {
		const result = await store.admitServer({
			name: "live",
			config: { command: "node", args: [] },
			scope: "project",
			sourceKind: "agent",
			intent: "start",
		})
		expect(result.disabled).toBe(false)
	})

	it("patchServer merges without dropping siblings", async () => {
		await store.admitServer({
			name: "a",
			config: { command: "node", alwaysAllow: ["t1"] },
			scope: "global",
			sourceKind: "manual_api",
			intent: "start",
		})
		await store.patchServer("global", "a", { disabled: true, timeout: 30 })
		const doc = await store.read("global")
		expect(doc.mcpServers.a.command).toBe("node")
		expect(doc.mcpServers.a.alwaysAllow).toEqual(["t1"])
		expect(doc.mcpServers.a.disabled).toBe(true)
		expect(doc.mcpServers.a.timeout).toBe(30)
	})

	it("removeServer deletes entry", async () => {
		await store.admitServer({
			name: "gone",
			config: { command: "x" },
			scope: "project",
			sourceKind: "import",
		})
		expect(await store.removeServer("project", "gone")).toBe(true)
		const doc = await store.read("project")
		expect(doc.mcpServers.gone).toBeUndefined()
		expect(await store.removeServer("project", "gone")).toBe(false)
	})

	it("preserves alwaysAllow on re-admit when new config omits it", async () => {
		await store.admitServer({
			name: "re",
			config: { command: "npx", alwaysAllow: ["tool-a"] },
			scope: "project",
			sourceKind: "marketplace",
			intent: "start",
		})
		await store.admitServer({
			name: "re",
			config: { command: "npx", args: ["-y", "pkg"] },
			scope: "project",
			sourceKind: "marketplace",
			intent: "preserve",
		})
		const doc = await store.read("project")
		expect(doc.mcpServers.re.alwaysAllow).toEqual(["tool-a"])
		expect(doc.mcpServers.re.disabled).toBe(false)
		expect(doc.mcpServers.re.args).toEqual(["-y", "pkg"])
	})
})
