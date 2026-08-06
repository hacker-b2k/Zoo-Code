import type { McpActivationIntent, McpAdmissionSourceKind, McpLifecycleMode } from "@roo-code/types"

export type { McpActivationIntent, McpAdmissionSourceKind, McpLifecycleMode }

export type ActivationPolicyContext = {
	mode: McpLifecycleMode
	sourceKind: McpAdmissionSourceKind
	intent?: McpActivationIntent
	isNew: boolean
	previous?: Record<string, unknown>
}

export type ShouldStartInput = {
	mcpEnabled: boolean
	/** True when server config has disabled === true */
	serverDisabled: boolean
}

export type DisableStartReason = "mcpDisabled" | "serverDisabled"

/**
 * Default intent for all managed sources (no per-source forks).
 * Marketplace, agent, import, etc. all default to install-only (disabled until user/agent starts).
 */
export function defaultIntentForSource(_kind: McpAdmissionSourceKind): McpActivationIntent {
	return "install_only"
}

/**
 * Resolve the explicit `disabled` flag for a config under managed admission or raw_load.
 *
 * raw_load: missing disabled ⇒ not disabled (backward compatible hand-edit/Git).
 * managed_admission: force explicit boolean from intent (default install_only → true).
 */
export function resolveDisabledOnAdmission(config: Record<string, unknown>, ctx: ActivationPolicyContext): boolean {
	if (ctx.mode === "raw_load") {
		return config.disabled === true
	}

	const intent = ctx.intent ?? defaultIntentForSource(ctx.sourceKind)

	switch (intent) {
		case "start":
			return false
		case "preserve": {
			if (ctx.previous && typeof ctx.previous.disabled === "boolean") {
				return ctx.previous.disabled
			}
			if (typeof config.disabled === "boolean") {
				return config.disabled
			}
			// No previous / no flag → safe default (do not auto-start)
			return true
		}
		case "install_only":
		default:
			return true
	}
}

/**
 * Apply activation policy: returns a shallow copy with explicit `disabled` boolean.
 */
export function applyActivationPolicy(
	config: Record<string, unknown>,
	ctx: ActivationPolicyContext,
): Record<string, unknown> {
	const disabled = resolveDisabledOnAdmission(config, ctx)
	return {
		...config,
		disabled,
	}
}

/**
 * Pure connect gate: process may start only if global MCP is on and server is not disabled.
 */
export function shouldStartMcpProcess(input: ShouldStartInput): boolean {
	return input.mcpEnabled === true && input.serverDisabled !== true
}

/**
 * Prefer MCP_DISABLED over SERVER_DISABLED when both would apply.
 */
export function resolveDisableStartReason(input: ShouldStartInput): DisableStartReason | null {
	if (input.mcpEnabled !== true) {
		return "mcpDisabled"
	}
	if (input.serverDisabled === true) {
		return "serverDisabled"
	}
	return null
}
