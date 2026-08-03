/**
 * ToolCallGuard.ts - Pure, side-effect-free guard that validates tool-call
 * parameters against the TOOL_PARAM_REGISTRY before a tool executes.
 *
 * The guard checks two categories in order:
 * 1. Required parameters - must be present and non-empty.
 * 2. Path parameters - workspace-relative file paths needing existence/type validation.
 *
 * Callers own all user-facing side effects (messages, logging, etc.).
 * The guard never calls task.say, writes to the console, or mutates state.
 */

import path from "path"
import * as fs from "fs/promises"

import { getToolParamSpec } from "./toolParamRegistry"

/**
 * Discriminant for the kind of guard violation detected.
 */
export type GuardViolationKind = "missing_param" | "path_is_directory" | "path_not_found"

/**
 * Describes a single violation found by the guard.
 */
export interface GuardViolation {
	/** The category of violation. */
	kind: GuardViolationKind
	/** The tool name that was being validated. */
	toolName: string
	/** The parameter name that triggered the violation. */
	paramName: string
	/**
	 * Human-readable message. For "missing_param" this is empty - the
	 * caller produces the message via task.sayAndCreateMissingParamError.
	 */
	message: string
	/** errorPrefix from the registry, or empty string if none was specified. */
	prefix: string
}

/**
 * Context provided by the caller for path resolution.
 */
export interface GuardContext {
	/** The current working directory used to resolve workspace-relative paths. */
	cwd: string
}

/**
 * Determine whether a parameter value is considered missing.
 *
 * A value is missing when it is undefined, null, an empty or whitespace-only
 * string, or an empty array.
 *
 * Any other value (including false, 0, {}) is considered present.
 *
 * @param value - The parameter value to check.
 * @returns true if the value is considered missing.
 */
function isMissing(value: unknown): boolean {
	if (value === undefined || value === null) {
		return true
	}

	if (typeof value === "string") {
		return value.trim().length === 0
	}

	if (Array.isArray(value)) {
		return value.length === 0
	}

	return false
}

/**
 * Safe default values for common tools. These are applied BEFORE validation
 * when the model omits a required parameter. Only parameters that are 100%
 * safe to default are included — ambiguous or destructive params are not.
 */
const SAFE_PARAM_DEFAULTS: Record<string, Record<string, unknown>> = {
	list_files: { path: ".", recursive: false },
	collect_results: { unread_only: true },
	list_workers: { include_completed: false },
	get_worker_status: {},
}

/**
 * Apply safe defaults for missing required parameters before validation.
 * Mutates the params object in-place. Only fills values that are undefined,
 * null, or empty string — explicit values are never overwritten.
 *
 * @param toolName - The tool name.
 * @param params - The raw parameter object (mutated in-place).
 */
export function applySafeDefaults(toolName: string, params: Record<string, unknown>): void {
	const defaults = SAFE_PARAM_DEFAULTS[toolName]
	if (!defaults) return
	for (const [key, value] of Object.entries(defaults)) {
		if (params[key] === undefined || params[key] === null || params[key] === "") {
			params[key] = value
		}
	}
}

/**
 * Validate that all required parameters for a tool are present and non-empty.
 *
 * Returns the first missing parameter in required array order, or null if all
 * required parameters are present.
 *
 * A param is MISSING when it is undefined, null, an empty/whitespace-only
 * string, or an empty array. Any other value (including false, 0, {}) is
 * PRESENT. Return the FIRST missing param in required array order, with
 * kind "missing_param" and message "".
 *
 * @param toolName - The tool name to look up in the registry.
 * @param params - The raw parameter object from the tool call.
 * @returns A GuardViolation with kind "missing_param" and an empty message,
 *   or null if all required params are present.
 */
export function validateRequiredParams(toolName: string, params: Record<string, unknown>): GuardViolation | null {
	const spec = getToolParamSpec(toolName)

	if (!spec) {
		return null
	}

	for (const paramName of spec.required) {
		if (isMissing(params[paramName])) {
			return {
				kind: "missing_param",
				toolName,
				paramName,
				message: "",
				prefix: spec.errorPrefix ?? "",
			}
		}
	}

	return null
}

/**
 * Validate workspace-relative file paths in the tool pathParams.
 *
 * This check only runs when all required params are present. For each
 * pathParams entry whose value is a non-empty string:
 *
 * - The value is resolved with path.resolve(ctx.cwd, value).
 * - If the resolved path is a directory and rejectDirectory is true,
 *   returns path_is_directory.
 * - If stat throws ENOENT and requireExists is true, returns path_not_found.
 *   If requireExists is false the param is skipped (valid new-file case).
 * - Any other stat error is silently skipped so the guard never breaks
 *   a working call - the tool itself will surface the real error.
 *
 * @param toolName - The tool name to look up in the registry.
 * @param params - The raw parameter object from the tool call.
 * @param ctx - Context providing cwd for path resolution.
 * @returns A GuardViolation or null if all path params are valid.
 */
export async function validatePathParams(
	toolName: string,
	params: Record<string, unknown>,
	ctx: GuardContext,
): Promise<GuardViolation | null> {
	const spec = getToolParamSpec(toolName)

	if (!spec || !spec.pathParams) {
		return null
	}

	const prefix = spec.errorPrefix ?? ""

	for (const paramName of spec.pathParams) {
		const rawValue = params[paramName]

		// Only validate non-empty strings.
		if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
			continue
		}

		const resolved = path.resolve(ctx.cwd, rawValue)
		let stat: Awaited<ReturnType<typeof fs.stat>>

		try {
			stat = await fs.stat(resolved)
		} catch (err: unknown) {
			if (
				typeof err === "object" &&
				err !== null &&
				"code" in err &&
				(err as { code: unknown }).code === "ENOENT"
			) {
				// File not found - only emit violation when requireExists is true.
				if (spec.requireExists) {
					const relPath = path.relative(ctx.cwd, resolved)

					return {
						kind: "path_not_found",
						toolName,
						paramName,
						message:
							"File does not exist at path: " +
							relPath +
							". Verify the path is correct and relative to the workspace root, or use list_files to locate it.",
						prefix,
					}
				}
			}

			// Any other stat error - skip and let the tool surface the real error.
			continue
		}

		// Check for directory rejection.
		if (stat.isDirectory() && spec.rejectDirectory) {
			const relPath = path.relative(ctx.cwd, resolved)

			if (toolName === "read_file") {
				return {
					kind: "path_is_directory",
					toolName,
					paramName,
					message: "Cannot read '" + relPath + "' because it is a directory. Use list_files tool instead.",
					prefix,
				}
			}

			return {
				kind: "path_is_directory",
				toolName,
				paramName,
				message:
					"Cannot apply '" +
					toolName +
					"' to '" +
					relPath +
					"' because it is a directory. Use list_files to inspect its contents.",
				prefix,
			}
		}
	}

	return null
}

/**
 * Runs required-param checks first, then path checks. Returns the first
 * violation found, or null if all checks pass.
 *
 * If getToolParamSpec(toolName) returns undefined, the function returns null
 * immediately (unknown/MCP/custom tools pass through untouched).
 *
 * @param toolName - The tool name to validate.
 * @param params - The raw parameter object from the tool call.
 * @param ctx - Context providing cwd for path resolution.
 * @returns The first GuardViolation found, or null if the tool call is valid.
 */
export async function runToolCallGuard(
	toolName: string,
	params: Record<string, unknown>,
	ctx: GuardContext,
): Promise<GuardViolation | null> {
	// Apply safe defaults before validation so the model doesn't fail on
	// common omissions like missing path or unread_only.
	applySafeDefaults(toolName, params)

	const requiredViolation = validateRequiredParams(toolName, params)

	if (requiredViolation) {
		return requiredViolation
	}

	return validatePathParams(toolName, params, ctx)
}
