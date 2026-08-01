import { describe, it, expect } from "vitest"

import { getNativeTools } from "../index"
import { toolNames } from "@roo-code/types"
import { ALWAYS_AVAILABLE_TOOLS } from "../../../../../shared/tools"
import writeSpec from "../write_spec"

describe("F-004 native tool registration", () => {
	it("includes list_specs, read_spec, write_spec, delete_spec in toolNames", () => {
		expect(toolNames).toContain("list_specs")
		expect(toolNames).toContain("read_spec")
		expect(toolNames).toContain("write_spec")
		expect(toolNames).toContain("delete_spec")
	})

	it("includes them in ALWAYS_AVAILABLE_TOOLS", () => {
		expect(ALWAYS_AVAILABLE_TOOLS).toContain("list_specs")
		expect(ALWAYS_AVAILABLE_TOOLS).toContain("read_spec")
		expect(ALWAYS_AVAILABLE_TOOLS).toContain("write_spec")
		expect(ALWAYS_AVAILABLE_TOOLS).toContain("delete_spec")
	})

	it("exposes them via getNativeTools()", () => {
		const tools = getNativeTools()
		const names = tools.map((t) => ("function" in t ? t.function.name : ""))
		expect(names).toContain("list_specs")
		expect(names).toContain("read_spec")
		expect(names).toContain("write_spec")
		expect(names).toContain("delete_spec")
	})

	it("write_spec schema documents create vs update and required keys", () => {
		const fn = writeSpec.function
		expect(fn.name).toBe("write_spec")
		const props = fn.parameters.properties as Record<
			string,
			{ type?: unknown; description?: string; items?: Record<string, unknown> }
		>
		// title may be string or string|null depending on schema strictness
		expect(props.title.type === "string" || Array.isArray(props.title.type)).toBe(true)
		expect(props.spec_id.type).toEqual(["string", "null"])
		// Problem B fix: `required` now contains only truly universal keys.
		// Mode-specific keys (title, content, mode, section_heading, old_string,
		// new_string, replace_all) are intentionally NOT in required[] so
		// non-strict gateways (MiMo, etc.) can omit them without emitting {}.
		// The official OpenAI provider re-injects all-required via
		// convertToolSchemaForOpenAI (enableStrict: true path).
		expect(fn.parameters.required).toEqual(["doc"])
		expect(props.replacements.type).toEqual(["array", "null"])
		expect(props.replacements.items).toMatchObject({
			type: "object",
			required: ["old_string", "new_string"],
			additionalProperties: false,
		})
		expect(fn.description).toContain("Create a new Spec Workspace")
		expect(fn.description).toContain('"spec_id": null')
	})
})
