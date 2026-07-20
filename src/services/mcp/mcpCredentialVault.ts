import type * as vscode from "vscode"
import type { McpConfigScope } from "@roo-code/types"

/**
 * Detect secret-like env/header keys for vault migration (heuristic + explicit marks).
 */
const SECRET_KEY_RE = /(token|api[_-]?key|secret|password|passwd|authorization|auth|credential|bearer)/i

export function isSecretLikeKey(key: string): boolean {
	return SECRET_KEY_RE.test(key)
}

export type VaultChannel = "env" | "header"

/**
 * MCP env/header credential vault on VS Code SecretStorage.
 * Key scheme: mcp.cred.v1.{scope}.{serverName}.{env|header}.{KEY}
 * OAuth remains on SecretStorageService (mcp.oauth.*).
 */
export class McpCredentialVault {
	private readonly storage: vscode.SecretStorage
	private readonly prefix = "mcp.cred.v1."

	constructor(storage: vscode.SecretStorage) {
		this.storage = storage
	}

	/** Build storage key; server names may contain dots — base64url-safe encode name. */
	private vaultKey(scope: McpConfigScope, serverName: string, channel: VaultChannel, key: string): string {
		const safeName = Buffer.from(serverName, "utf8").toString("base64url")
		const safeKey = Buffer.from(key, "utf8").toString("base64url")
		return `${this.prefix}${scope}.${safeName}.${channel}.${safeKey}`
	}

	private metaKey(scope: McpConfigScope, serverName: string): string {
		const safeName = Buffer.from(serverName, "utf8").toString("base64url")
		return `${this.prefix}${scope}.${safeName}.meta`
	}

	private async readMeta(scope: McpConfigScope, serverName: string): Promise<{ env: string[]; header: string[] }> {
		const raw = await this.storage.get(this.metaKey(scope, serverName))
		if (!raw) {
			return { env: [], header: [] }
		}
		try {
			const parsed = JSON.parse(raw) as { env?: string[]; header?: string[] }
			return {
				env: Array.isArray(parsed.env) ? parsed.env : [],
				header: Array.isArray(parsed.header) ? parsed.header : [],
			}
		} catch {
			return { env: [], header: [] }
		}
	}

	private async writeMeta(
		scope: McpConfigScope,
		serverName: string,
		meta: { env: string[]; header: string[] },
	): Promise<void> {
		await this.storage.store(this.metaKey(scope, serverName), JSON.stringify(meta))
	}

	async setEnvSecret(
		scope: McpConfigScope,
		serverName: string,
		envKey: string,
		value: string | undefined | null,
	): Promise<void> {
		const key = this.vaultKey(scope, serverName, "env", envKey)
		const meta = await this.readMeta(scope, serverName)
		if (value === undefined || value === null || value === "") {
			await this.storage.delete(key)
			meta.env = meta.env.filter((k) => k !== envKey)
		} else {
			await this.storage.store(key, value)
			if (!meta.env.includes(envKey)) {
				meta.env.push(envKey)
			}
		}
		await this.writeMeta(scope, serverName, meta)
	}

	async getEnvSecrets(scope: McpConfigScope, serverName: string, keys?: string[]): Promise<Record<string, string>> {
		const meta = await this.readMeta(scope, serverName)
		const list = keys ?? meta.env
		const out: Record<string, string> = {}
		for (const envKey of list) {
			const v = await this.storage.get(this.vaultKey(scope, serverName, "env", envKey))
			if (v !== undefined) {
				out[envKey] = v
			}
		}
		return out
	}

	async setHeaderSecret(
		scope: McpConfigScope,
		serverName: string,
		headerName: string,
		value: string | undefined | null,
	): Promise<void> {
		const key = this.vaultKey(scope, serverName, "header", headerName)
		const meta = await this.readMeta(scope, serverName)
		if (value === undefined || value === null || value === "") {
			await this.storage.delete(key)
			meta.header = meta.header.filter((k) => k !== headerName)
		} else {
			await this.storage.store(key, value)
			if (!meta.header.includes(headerName)) {
				meta.header.push(headerName)
			}
		}
		await this.writeMeta(scope, serverName, meta)
	}

	async getHeaderSecrets(
		scope: McpConfigScope,
		serverName: string,
		keys?: string[],
	): Promise<Record<string, string>> {
		const meta = await this.readMeta(scope, serverName)
		const list = keys ?? meta.header
		const out: Record<string, string> = {}
		for (const headerName of list) {
			const v = await this.storage.get(this.vaultKey(scope, serverName, "header", headerName))
			if (v !== undefined) {
				out[headerName] = v
			}
		}
		return out
	}

	async deleteServerSecrets(scope: McpConfigScope, serverName: string): Promise<void> {
		const meta = await this.readMeta(scope, serverName)
		for (const envKey of meta.env) {
			await this.storage.delete(this.vaultKey(scope, serverName, "env", envKey))
		}
		for (const headerName of meta.header) {
			await this.storage.delete(this.vaultKey(scope, serverName, "header", headerName))
		}
		await this.storage.delete(this.metaKey(scope, serverName))
	}

	/**
	 * Move secret-like env/header values into vault; return sanitized config for JSON.
	 * Sets envSecretKeys / headerSecretKeys ref arrays; leaves non-secret env in JSON.
	 */
	async migratePlaintextFromConfig(
		scope: McpConfigScope,
		serverName: string,
		config: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const next: Record<string, unknown> = { ...config }
		const envSecretKeys: string[] = Array.isArray(config.envSecretKeys)
			? [...(config.envSecretKeys as string[])]
			: []
		const headerSecretKeys: string[] = Array.isArray(config.headerSecretKeys)
			? [...(config.headerSecretKeys as string[])]
			: []

		const env =
			config.env && typeof config.env === "object" && !Array.isArray(config.env)
				? { ...(config.env as Record<string, string>) }
				: undefined
		if (env) {
			const kept: Record<string, string> = {}
			for (const [k, v] of Object.entries(env)) {
				if (typeof v === "string" && isSecretLikeKey(k) && v.length > 0) {
					await this.setEnvSecret(scope, serverName, k, v)
					if (!envSecretKeys.includes(k)) {
						envSecretKeys.push(k)
					}
				} else if (v !== undefined && v !== null) {
					kept[k] = String(v)
				}
			}
			next.env = Object.keys(kept).length > 0 ? kept : undefined
		}

		const headers =
			config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)
				? { ...(config.headers as Record<string, string>) }
				: undefined
		if (headers) {
			const kept: Record<string, string> = {}
			for (const [k, v] of Object.entries(headers)) {
				if (typeof v === "string" && isSecretLikeKey(k) && v.length > 0) {
					await this.setHeaderSecret(scope, serverName, k, v)
					if (!headerSecretKeys.includes(k)) {
						headerSecretKeys.push(k)
					}
				} else if (v !== undefined && v !== null) {
					kept[k] = String(v)
				}
			}
			next.headers = Object.keys(kept).length > 0 ? kept : undefined
		}

		if (envSecretKeys.length > 0) {
			next.envSecretKeys = envSecretKeys
		}
		if (headerSecretKeys.length > 0) {
			next.headerSecretKeys = headerSecretKeys
		}

		return next
	}

	/**
	 * Merge vault secrets into config for connect (does not mutate vault).
	 */
	async hydrateConfig(
		scope: McpConfigScope,
		serverName: string,
		config: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const envKeys = Array.isArray(config.envSecretKeys) ? (config.envSecretKeys as string[]) : undefined
		const headerKeys = Array.isArray(config.headerSecretKeys) ? (config.headerSecretKeys as string[]) : undefined

		const envSecrets = await this.getEnvSecrets(scope, serverName, envKeys)
		const headerSecrets = await this.getHeaderSecrets(scope, serverName, headerKeys)

		const env =
			config.env && typeof config.env === "object" && !Array.isArray(config.env)
				? { ...(config.env as Record<string, string>) }
				: {}
		const headers =
			config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)
				? { ...(config.headers as Record<string, string>) }
				: {}

		Object.assign(env, envSecrets)
		Object.assign(headers, headerSecrets)

		return {
			...config,
			env: Object.keys(env).length > 0 ? env : config.env,
			headers: Object.keys(headers).length > 0 ? headers : config.headers,
		}
	}

	/** Redacted view for tools/UI — never returns secret values. */
	listSecretRefs(config: Record<string, unknown>): { envSecretKeys: string[]; headerSecretKeys: string[] } {
		return {
			envSecretKeys: Array.isArray(config.envSecretKeys) ? (config.envSecretKeys as string[]) : [],
			headerSecretKeys: Array.isArray(config.headerSecretKeys) ? (config.headerSecretKeys as string[]) : [],
		}
	}
}
