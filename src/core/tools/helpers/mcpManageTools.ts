import type { McpConfigScope } from "@roo-code/types"

import type { Task } from "../../task/Task"
import type { McpHub } from "../../../services/mcp/McpHub"
import { isSecretLikeKey } from "../../../services/mcp/McpCredentialVault"

export function getClineProvider(task: Task) {
	const provider = task.providerRef.deref()
	if (!provider) {
		throw new Error("Extension provider is not available")
	}
	return provider
}

export function getMcpHub(task: Task): McpHub {
	const provider = getClineProvider(task)
	const hub = provider.getMcpHub?.()
	if (!hub) {
		throw new Error("MCP hub is not available")
	}
	return hub
}

export function parseScope(raw: unknown): McpConfigScope | undefined {
	if (raw === "project" || raw === "global") {
		return raw
	}
	return undefined
}

/**
 * Redact secret-like env/header values and mark vault refs.
 * Never returns secret string values.
 */
export function redactMcpServerConfig(config: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...config }

	const envSecretKeys = Array.isArray(config.envSecretKeys) ? [...(config.envSecretKeys as string[])] : []
	const headerSecretKeys = Array.isArray(config.headerSecretKeys) ? [...(config.headerSecretKeys as string[])] : []

	if (config.env && typeof config.env === "object" && !Array.isArray(config.env)) {
		const envOut: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(config.env as Record<string, unknown>)) {
			if (isSecretLikeKey(k) || envSecretKeys.includes(k)) {
				envOut[k] = "***"
				if (!envSecretKeys.includes(k)) {
					envSecretKeys.push(k)
				}
			} else {
				envOut[k] = v
			}
		}
		out.env = envOut
	}

	if (config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)) {
		const headersOut: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(config.headers as Record<string, unknown>)) {
			if (isSecretLikeKey(k) || headerSecretKeys.includes(k)) {
				headersOut[k] = "***"
				if (!headerSecretKeys.includes(k)) {
					headerSecretKeys.push(k)
				}
			} else {
				headersOut[k] = v
			}
		}
		out.headers = headersOut
	}

	if (envSecretKeys.length > 0) {
		out.envSecretKeys = envSecretKeys
	}
	if (headerSecretKeys.length > 0) {
		out.headerSecretKeys = headerSecretKeys
	}

	return out
}

/**
 * Split secret-like env/headers out of a manage config payload for vault migration.
 */
export function extractSecretMapsFromConfig(config: Record<string, unknown>): {
	sanitized: Record<string, unknown>
	envSecrets: Record<string, string>
	headerSecrets: Record<string, string>
} {
	const sanitized: Record<string, unknown> = { ...config }
	const envSecrets: Record<string, string> = {}
	const headerSecrets: Record<string, string> = {}

	if (config.env && typeof config.env === "object" && !Array.isArray(config.env)) {
		const kept: Record<string, string> = {}
		for (const [k, v] of Object.entries(config.env as Record<string, unknown>)) {
			if (typeof v === "string" && isSecretLikeKey(k) && v.length > 0) {
				envSecrets[k] = v
			} else if (v !== undefined && v !== null) {
				kept[k] = String(v)
			}
		}
		sanitized.env = Object.keys(kept).length > 0 ? kept : undefined
	}

	if (config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)) {
		const kept: Record<string, string> = {}
		for (const [k, v] of Object.entries(config.headers as Record<string, unknown>)) {
			if (typeof v === "string" && isSecretLikeKey(k) && v.length > 0) {
				headerSecrets[k] = v
			} else if (v !== undefined && v !== null) {
				kept[k] = String(v)
			}
		}
		sanitized.headers = Object.keys(kept).length > 0 ? kept : undefined
	}

	return { sanitized, envSecrets, headerSecrets }
}

export function validateCwd(cwd: unknown): string | undefined {
	if (cwd === undefined || cwd === null || cwd === "") {
		return undefined
	}
	if (typeof cwd !== "string") {
		throw new Error("cwd must be a string")
	}
	// Reject path traversal / absolute Windows drive escape patterns that look malicious
	if (cwd.includes("..") || cwd.includes("\0")) {
		throw new Error("cwd rejects path traversal or null bytes")
	}
	return cwd
}
