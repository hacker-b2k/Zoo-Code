import { describe, it, expect } from "vitest"
import { redactMcpServerConfig, extractSecretMapsFromConfig, validateCwd, parseScope } from "../mcpManageTools"

describe("mcpManageTools helpers", () => {
	it("parseScope accepts project/global only", () => {
		expect(parseScope("project")).toBe("project")
		expect(parseScope("global")).toBe("global")
		expect(parseScope("all")).toBeUndefined()
		expect(parseScope(undefined)).toBeUndefined()
	})

	it("redactMcpServerConfig masks secret-like env/headers", () => {
		const redacted = redactMcpServerConfig({
			command: "npx",
			args: ["-y", "server"],
			env: {
				NODE_ENV: "production",
				GITHUB_TOKEN: "ghp_secret_value",
			},
			headers: {
				"X-Custom": "ok",
				Authorization: "Bearer secret",
			},
			envSecretKeys: ["OTHER_KEY"],
		})

		expect(redacted.command).toBe("npx")
		expect((redacted.env as Record<string, unknown>).NODE_ENV).toBe("production")
		expect((redacted.env as Record<string, unknown>).GITHUB_TOKEN).toBe("***")
		expect((redacted.headers as Record<string, unknown>).Authorization).toBe("***")
		expect((redacted.headers as Record<string, unknown>)["X-Custom"]).toBe("ok")
		expect(redacted.envSecretKeys).toEqual(expect.arrayContaining(["OTHER_KEY", "GITHUB_TOKEN"]))
		expect(JSON.stringify(redacted)).not.toContain("ghp_secret_value")
		expect(JSON.stringify(redacted)).not.toContain("Bearer secret")
	})

	it("extractSecretMapsFromConfig splits secret-like values", () => {
		const { sanitized, envSecrets, headerSecrets } = extractSecretMapsFromConfig({
			command: "node",
			env: { API_KEY: "secret1", PATH: "/usr/bin" },
			headers: { Authorization: "tok", Accept: "json" },
		})

		expect(envSecrets.API_KEY).toBe("secret1")
		expect(headerSecrets.Authorization).toBe("tok")
		expect((sanitized.env as Record<string, string>).PATH).toBe("/usr/bin")
		expect((sanitized.env as Record<string, string>).API_KEY).toBeUndefined()
		expect((sanitized.headers as Record<string, string>).Accept).toBe("json")
		expect((sanitized.headers as Record<string, string>).Authorization).toBeUndefined()
	})

	it("validateCwd rejects traversal", () => {
		expect(validateCwd(undefined)).toBeUndefined()
		expect(validateCwd("/tmp/mcp")).toBe("/tmp/mcp")
		expect(() => validateCwd("../evil")).toThrow(/traversal/)
		expect(() => validateCwd("foo\0bar")).toThrow(/null/)
	})
})
