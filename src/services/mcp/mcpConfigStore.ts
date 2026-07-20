import * as fs from "fs/promises"
import * as path from "path"

import type { McpActivationIntent, McpAdmissionSourceKind, McpConfigScope } from "@roo-code/types"

import { safeWriteJson } from "../../utils/safeWriteJson"
import { applyActivationPolicy, defaultIntentForSource } from "./mcpLifecyclePolicy"

export type { McpConfigScope }

export interface McpConfigDocument {
	mcpServers: Record<string, Record<string, unknown>>
	[key: string]: unknown
}

export type McpConfigPathResolver = (scope: McpConfigScope) => Promise<string>

export interface McpConfigStoreOptions {
	resolvePath: McpConfigPathResolver
	/** Called around programmatic writes so hub can suppress watcher restarts. */
	onProgrammaticWrite?: (active: boolean) => void
}

export interface AdmitServerParams {
	name: string
	config: Record<string, unknown>
	scope: McpConfigScope
	sourceKind: McpAdmissionSourceKind
	intent?: McpActivationIntent
}

export interface AdmitServerResult {
	path: string
	disabled: boolean
	doc: McpConfigDocument
}

const EMPTY_DOC = (): McpConfigDocument => ({ mcpServers: {} })

/**
 * Single write funnel for MCP JSON (project `.roo/mcp.json` + global `mcp_settings.json`).
 * Preserves unknown top-level keys; managed admits go through lifecycle policy.
 */
export class McpConfigStore {
	private readonly resolvePath: McpConfigPathResolver
	private readonly onProgrammaticWrite?: (active: boolean) => void
	private flagResetTimer: ReturnType<typeof setTimeout> | undefined

	constructor(options: McpConfigStoreOptions) {
		this.resolvePath = options.resolvePath
		this.onProgrammaticWrite = options.onProgrammaticWrite
	}

	async resolvePathForScope(scope: McpConfigScope): Promise<string> {
		return this.resolvePath(scope)
	}

	async ensure(scope: McpConfigScope): Promise<string> {
		const filePath = await this.resolvePath(scope)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		try {
			await fs.access(filePath)
		} catch {
			await this.writeDocument(filePath, EMPTY_DOC())
		}
		return filePath
	}

	async read(scope: McpConfigScope): Promise<McpConfigDocument> {
		const filePath = await this.ensure(scope)
		try {
			const raw = await fs.readFile(filePath, "utf-8")
			const parsed = JSON.parse(raw) as unknown
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return EMPTY_DOC()
			}
			const doc = parsed as Record<string, unknown>
			const mcpServers =
				doc.mcpServers && typeof doc.mcpServers === "object" && !Array.isArray(doc.mcpServers)
					? (doc.mcpServers as Record<string, Record<string, unknown>>)
					: {}
			return { ...doc, mcpServers }
		} catch (error) {
			if (error instanceof SyntaxError) {
				throw new Error(
					`Cannot read MCP config: invalid JSON in ${scope === "project" ? ".roo/mcp.json" : "mcp_settings.json"}. Fix the file before continuing.`,
				)
			}
			throw error
		}
	}

	async write(scope: McpConfigScope, doc: McpConfigDocument): Promise<void> {
		const filePath = await this.ensure(scope)
		const mcpServers =
			doc.mcpServers && typeof doc.mcpServers === "object" && !Array.isArray(doc.mcpServers) ? doc.mcpServers : {}
		const next: McpConfigDocument = { ...doc, mcpServers }
		await this.writeDocument(filePath, next)
	}

	/**
	 * Managed admit: apply activation policy, merge user fields, write preserving top-level keys.
	 */
	async admitServer(params: AdmitServerParams): Promise<AdmitServerResult> {
		const { name, config, scope, sourceKind } = params
		const intent = params.intent ?? defaultIntentForSource(sourceKind)
		const filePath = await this.ensure(scope)
		const doc = await this.read(scope)
		const previous = doc.mcpServers[name]
		const isNew = !previous

		const policyConfig = applyActivationPolicy(
			{ ...config },
			{
				mode: "managed_admission",
				sourceKind,
				intent,
				isNew,
				previous,
			},
		)

		// Preserve user tool prefs on reinstall when not supplied by new config
		const preserved: Record<string, unknown> = {}
		if (previous) {
			if (Array.isArray(previous.alwaysAllow) && policyConfig.alwaysAllow === undefined) {
				preserved.alwaysAllow = previous.alwaysAllow
			}
			if (Array.isArray(previous.disabledTools) && policyConfig.disabledTools === undefined) {
				preserved.disabledTools = previous.disabledTools
			}
			if (intent === "preserve") {
				// Keep non-overridden previous fields under transport keys already in config
				for (const key of Object.keys(previous)) {
					if (policyConfig[key] === undefined && preserved[key] === undefined && key !== "disabled") {
						// Only keep list-like prefs already handled; avoid re-applying stale command from partial updates
						if (key === "timeout" && typeof previous.timeout === "number") {
							preserved.timeout = previous.timeout
						}
					}
				}
			}
		}

		const merged: Record<string, unknown> = {
			...preserved,
			...policyConfig,
			disabled: policyConfig.disabled === true,
		}

		doc.mcpServers[name] = merged
		await this.write(scope, doc)

		return {
			path: filePath,
			disabled: merged.disabled === true,
			doc,
		}
	}

	async patchServer(scope: McpConfigScope, name: string, patch: Record<string, unknown>): Promise<void> {
		const doc = await this.read(scope)
		const existing = doc.mcpServers[name]
		if (!existing) {
			throw new Error(`Server ${name} not found in ${scope} MCP config`)
		}
		const next = { ...existing, ...patch }
		if (!Array.isArray(next.alwaysAllow)) {
			next.alwaysAllow = Array.isArray(existing.alwaysAllow) ? existing.alwaysAllow : []
		}
		doc.mcpServers[name] = next
		await this.write(scope, doc)
	}

	async removeServer(scope: McpConfigScope, name: string): Promise<boolean> {
		const doc = await this.read(scope)
		if (!doc.mcpServers[name]) {
			return false
		}
		delete doc.mcpServers[name]
		await this.write(scope, doc)
		return true
	}

	async getServer(scope: McpConfigScope, name: string): Promise<Record<string, unknown> | undefined> {
		const doc = await this.read(scope)
		return doc.mcpServers[name]
	}

	/**
	 * List server names + redacted summary (no secret values).
	 */
	async listServers(
		scope: McpConfigScope,
	): Promise<Array<{ name: string; disabled: boolean; type?: string; command?: string; url?: string }>> {
		const doc = await this.read(scope)
		return Object.entries(doc.mcpServers).map(([name, cfg]) => ({
			name,
			disabled: cfg.disabled === true,
			type: typeof cfg.type === "string" ? cfg.type : undefined,
			command: typeof cfg.command === "string" ? cfg.command : undefined,
			url: typeof cfg.url === "string" ? cfg.url : undefined,
		}))
	}

	private async writeDocument(filePath: string, doc: McpConfigDocument): Promise<void> {
		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
			this.flagResetTimer = undefined
		}
		this.onProgrammaticWrite?.(true)
		try {
			await safeWriteJson(filePath, doc, { prettyPrint: true })
		} finally {
			this.flagResetTimer = setTimeout(() => {
				this.onProgrammaticWrite?.(false)
				this.flagResetTimer = undefined
			}, 600)
		}
	}
}

/**
 * Build path resolver for VS Code extension context (global settings + workspace project).
 */
export function createDefaultMcpPathResolver(params: {
	getGlobalSettingsDir: () => Promise<string>
	getProjectRoot: () => string | undefined
	globalFileName?: string
}): McpConfigPathResolver {
	const globalFileName = params.globalFileName ?? "mcp_settings.json"
	return async (scope) => {
		if (scope === "global") {
			const dir = await params.getGlobalSettingsDir()
			return path.join(dir, globalFileName)
		}
		const root = params.getProjectRoot()
		if (!root) {
			throw new Error("No workspace folder found for project MCP config")
		}
		return path.join(root, ".roo", "mcp.json")
	}
}
