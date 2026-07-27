import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import path from "path"

import { validateRequiredParams, validatePathParams, runToolCallGuard } from "../ToolCallGuard"
import { getToolParamSpec, TOOL_PARAM_REGISTRY } from "../toolParamRegistry"

let cwd: string
let ctx: { cwd: string }

beforeAll(async () => {
	cwd = await fs.mkdtemp(path.join(os.tmpdir(), "tool-call-guard-"))
	ctx = { cwd }

	await fs.mkdir(path.join(cwd, "src"), { recursive: true })
	await fs.writeFile(path.join(cwd, "src", "existing.ts"), "export const a = 1\n", "utf8")
})

afterAll(async () => {
	await fs.rm(cwd, { recursive: true, force: true })
})

describe("toolParamRegistry", () => {
	it("returns undefined for unknown / MCP / custom tools", () => {
		expect(getToolParamSpec("mcp_some_server_do_thing")).toBeUndefined()
		expect(getToolParamSpec("totally_made_up_tool")).toBeUndefined()
	})

	it("describes read_file with directory rejection and existence requirement", () => {
		const spec = getToolParamSpec("read_file")
		expect(spec).toBeDefined()
		expect(spec!.required).toEqual(["path"])
		expect(spec!.pathParams).toEqual(["path"])
		expect(spec!.rejectDirectory).toBe(true)
		expect(spec!.requireExists).toBe(true)
		expect(spec!.errorPrefix).toBe("Error: ")
	})

	it("does not require write_to_file targets to already exist", () => {
		const spec = getToolParamSpec("write_to_file")
		expect(spec!.required).toEqual(["path", "content"])
		expect(spec!.rejectDirectory).toBe(true)
		expect(spec!.requireExists).toBeFalsy()
	})

	it("allows directories for list_files", () => {
		const spec = getToolParamSpec("list_files")
		expect(spec!.required).toEqual(["path"])
		expect(spec!.rejectDirectory).toBeFalsy()
	})

	it("only declares pathParams that are also declared required or optional strings", () => {
		for (const [toolName, spec] of Object.entries(TOOL_PARAM_REGISTRY)) {
			for (const p of spec.pathParams ?? []) {
				expect(typeof p, `${toolName}.pathParams entry`).toBe("string")
				expect(p.length).toBeGreaterThan(0)
			}
		}
	})
})

describe("validateRequiredParams", () => {
	it("passes through unknown tools", () => {
		expect(validateRequiredParams("not_a_real_tool", {})).toBeNull()
	})

	it("returns null when all required params are present", () => {
		expect(validateRequiredParams("read_file", { path: "src/existing.ts" })).toBeNull()
	})

	it.each([
		["undefined", undefined],
		["null", null],
		["empty string", ""],
		["whitespace only", "   "],
	])("flags a %s value as missing", (_label, value) => {
		const violation = validateRequiredParams("read_file", { path: value })
		expect(violation).not.toBeNull()
		expect(violation!.kind).toBe("missing_param")
		expect(violation!.paramName).toBe("path")
	})

	it("treats an empty array as missing", () => {
		const violation = validateRequiredParams("open_tabs", { urls: [] })
		expect(violation).not.toBeNull()
		expect(violation!.paramName).toBe("urls")
	})

	it("leaves the message empty so callers can use sayAndCreateMissingParamError", () => {
		const violation = validateRequiredParams("read_file", {})
		expect(violation!.message).toBe("")
		expect(violation!.prefix).toBe("Error: ")
	})

	it("reports the first missing param in declaration order", () => {
		const violation = validateRequiredParams("apply_diff", {})
		expect(violation!.paramName).toBe("path")

		const second = validateRequiredParams("apply_diff", { path: "src/existing.ts" })
		expect(second!.paramName).toBe("diff")
	})

	it("does not treat false or 0 as missing", () => {
		expect(validateRequiredParams("web_research", { action: "search" })).toBeNull()
	})
})

describe("validatePathParams", () => {
	it("passes through unknown tools", async () => {
		expect(await validatePathParams("not_a_real_tool", { path: "whatever" }, ctx)).toBeNull()
	})

	it("passes through tools without pathParams", async () => {
		expect(await validatePathParams("execute_command", { command: "ls" }, ctx)).toBeNull()
	})

	it("accepts an existing file", async () => {
		expect(await validatePathParams("read_file", { path: "src/existing.ts" }, ctx)).toBeNull()
	})

	it("rejects a directory for read_file and suggests list_files", async () => {
		const violation = await validatePathParams("read_file", { path: "src" }, ctx)
		expect(violation).not.toBeNull()
		expect(violation!.kind).toBe("path_is_directory")
		expect(violation!.message).toBe("Cannot read 'src' because it is a directory. Use list_files tool instead.")
	})

	it("rejects a directory for apply_diff with the generic message", async () => {
		const violation = await validatePathParams("apply_diff", { path: "src", diff: "x" }, ctx)
		expect(violation).not.toBeNull()
		expect(violation!.kind).toBe("path_is_directory")
		expect(violation!.message).toContain("apply_diff")
		expect(violation!.message).toContain("list_files")
	})

	it("allows a directory for list_files", async () => {
		expect(await validatePathParams("list_files", { path: "src" }, ctx)).toBeNull()
	})

	it("reports a missing file when requireExists is set", async () => {
		const violation = await validatePathParams("read_file", { path: "src/nope.ts" }, ctx)
		expect(violation).not.toBeNull()
		expect(violation!.kind).toBe("path_not_found")
		expect(violation!.message).toContain("src")
		expect(violation!.message).toContain("nope.ts")
	})

	it("allows a non-existent path for write_to_file", async () => {
		const violation = await validatePathParams("write_to_file", { path: "src/brand-new.ts", content: "x" }, ctx)
		expect(violation).toBeNull()
	})

	it("still rejects a directory for write_to_file", async () => {
		const violation = await validatePathParams("write_to_file", { path: "src", content: "x" }, ctx)
		expect(violation!.kind).toBe("path_is_directory")
	})

	it("skips non-string and empty path values", async () => {
		expect(await validatePathParams("read_file", { path: 42 }, ctx)).toBeNull()
		expect(await validatePathParams("read_file", { path: "   " }, ctx)).toBeNull()
	})

	it("resolves paths relative to the provided cwd", async () => {
		const absolute = path.join(cwd, "src", "existing.ts")
		expect(await validatePathParams("read_file", { path: absolute }, ctx)).toBeNull()
	})
})

describe("runToolCallGuard", () => {
	it("returns null for unknown tools", async () => {
		expect(await runToolCallGuard("mcp_x_y", { anything: 1 }, ctx)).toBeNull()
	})

	it("returns null for a fully valid call", async () => {
		expect(await runToolCallGuard("read_file", { path: "src/existing.ts" }, ctx)).toBeNull()
	})

	it("prefers the missing-param violation over the path violation", async () => {
		// `path` points at a directory AND `diff` is missing - required wins.
		const violation = await runToolCallGuard("apply_diff", { path: "src" }, ctx)
		expect(violation!.kind).toBe("missing_param")
		expect(violation!.paramName).toBe("diff")
	})

	it("falls through to path validation when required params are satisfied", async () => {
		const violation = await runToolCallGuard("apply_diff", { path: "src", diff: "some diff" }, ctx)
		expect(violation!.kind).toBe("path_is_directory")
	})

	it("catches the directory read before any approval would be requested", async () => {
		const violation = await runToolCallGuard("read_file", { path: "src" }, ctx)
		expect(violation!.kind).toBe("path_is_directory")
		expect(violation!.prefix).toBe("Error: ")
	})
})
