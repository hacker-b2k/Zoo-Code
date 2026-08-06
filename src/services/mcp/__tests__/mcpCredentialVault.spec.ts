import { describe, it, expect, beforeEach } from "vitest"
import { McpCredentialVault, isSecretLikeKey } from "../mcpCredentialVault"

function createMemorySecrets() {
	const map = new Map<string, string>()
	return {
		get: async (k: string) => map.get(k),
		store: async (k: string, v: string) => {
			map.set(k, v)
		},
		delete: async (k: string) => {
			map.delete(k)
		},
		onDidChange: () => ({ dispose: () => {} }),
		_map: map,
	}
}

describe("mcpCredentialVault", () => {
	let vault: McpCredentialVault
	let secrets: ReturnType<typeof createMemorySecrets>

	beforeEach(() => {
		secrets = createMemorySecrets()
		vault = new McpCredentialVault(secrets as any)
	})

	it("isSecretLikeKey detects common secret names", () => {
		expect(isSecretLikeKey("API_KEY")).toBe(true)
		expect(isSecretLikeKey("GITHUB_TOKEN")).toBe(true)
		expect(isSecretLikeKey("Authorization")).toBe(true)
		expect(isSecretLikeKey("DEBUG")).toBe(false)
		expect(isSecretLikeKey("NODE_ENV")).toBe(false)
	})

	it("stores and retrieves env secrets without echoing on clear", async () => {
		await vault.setEnvSecret("project", "github", "API_KEY", "sk-secret")
		const got = await vault.getEnvSecrets("project", "github")
		expect(got).toEqual({ API_KEY: "sk-secret" })
		await vault.setEnvSecret("project", "github", "API_KEY", "")
		expect(await vault.getEnvSecrets("project", "github")).toEqual({})
	})

	it("migratePlaintextFromConfig strips secrets and sets refs", async () => {
		const sanitized = await vault.migratePlaintextFromConfig("global", "svc", {
			command: "npx",
			env: { API_KEY: "sk-1", DEBUG: "1" },
			headers: { Authorization: "Bearer x", "X-Public": "ok" },
		})
		expect(sanitized.env).toEqual({ DEBUG: "1" })
		expect(sanitized.headers).toEqual({ "X-Public": "ok" })
		expect(sanitized.envSecretKeys).toContain("API_KEY")
		expect(sanitized.headerSecretKeys).toContain("Authorization")
		expect(JSON.stringify(sanitized)).not.toContain("sk-1")
		expect(JSON.stringify(sanitized)).not.toContain("Bearer x")

		const hydrated = await vault.hydrateConfig("global", "svc", sanitized)
		expect((hydrated.env as any).API_KEY).toBe("sk-1")
		expect((hydrated.headers as any).Authorization).toBe("Bearer x")
		expect((hydrated.env as any).DEBUG).toBe("1")
	})

	it("deleteServerSecrets removes all keys", async () => {
		await vault.setEnvSecret("project", "a", "TOKEN", "t")
		await vault.setHeaderSecret("project", "a", "Authorization", "h")
		await vault.deleteServerSecrets("project", "a")
		expect(await vault.getEnvSecrets("project", "a")).toEqual({})
		expect(await vault.getHeaderSecrets("project", "a")).toEqual({})
	})
})
