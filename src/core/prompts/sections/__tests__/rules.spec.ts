import { getRulesSection } from "../rules"

describe("getRulesSection spec-first guidance", () => {
	const rules = getRulesSection("/workspace")

	it("prefers the virtual Spec Workspace for clearly identified planning artifacts", () => {
		expect(rules).toContain("requirements, design documents, architecture plans, implementation plans, or ADRs")
		expect(rules).toContain("prefer `write_spec` and `read_spec` for the virtual Spec Workspace")
		expect(rules).toContain("Do not create project Markdown files for these artifacts by default")
	})

	it("keeps coding and implementation tasks on normal project file tools", () => {
		expect(rules).toContain("For code changes, configuration changes, and implementation work")
		expect(rules).toContain("continue using normal project file tools")
	})

	it("allows project writes when the user explicitly requests a destination or export", () => {
		expect(rules).toContain(
			"unless the user explicitly requests a project path, repository-visible file, export, or materialization",
		)
	})

	it("does not force write_spec for ambiguous requests", () => {
		expect(rules).toContain("If the requested artifact or destination is materially ambiguous")
		expect(rules).toContain(
			"preserve the ordinary workflow or ask for clarification rather than forcing `write_spec`",
		)
		expect(rules).not.toContain("err on the side of `write_spec`")
	})

	it("requires list_specs before creating a new pack and prefers update when a pack matches", () => {
		expect(rules).toContain("call `list_specs` first")
		expect(rules).toContain("Prefer updating the Active/last-opened pack")
		expect(rules).toContain(
			"Create a new pack only when no pack exists, the user explicitly asks for a new/separate spec, or the work is a distinct product/feature area",
		)
	})

	it("asks the user when multiple packs match instead of creating a near-duplicate", () => {
		expect(rules).toContain("If multiple packs match and none is active, ask which to update")
	})

	it("maps planning requests to requirements/design/tasks document kinds", () => {
		expect(rules).toContain("requirements/user stories/acceptance criteria → doc `requirements`")
		expect(rules).toContain("architecture/design/ADR → `design`")
		expect(rules).toContain("implementation plan/task breakdown → `tasks`")
	})

	it("requires read_spec before full replace and prefers partial modes for small edits", () => {
		expect(rules).toContain("Always use read_spec before large replace merges")
		expect(rules).toContain("search_replace")
		expect(rules).toContain("inside the same pack")
	})

	it("keeps mixed planning+coding split and prefers update over create for planning parts", () => {
		expect(rules).toContain("prefer update over create")
		expect(rules).toContain("apply code changes to the project")
	})

	it("mentions Spec Workspace index in environment_details (F-006)", () => {
		expect(rules).toContain("compact Spec Workspace index")
		expect(rules).toContain("Prefer that index over calling list_specs every turn")
	})

	it("forbids truncated display ids as tool parameters (F-006b)", () => {
		expect(rules).toContain("Never pass truncated or display-only ids")
		expect(rules).toContain("prefer spec_id: null")
		expect(rules).toContain("full id from the tool result")
	})

	it("forbids project-markdown fallback when write_spec fails for planning artifacts", () => {
		expect(rules).toContain("must never fall back to project Markdown if `write_spec` fails")
		expect(rules).toContain("never auto-create project plan Markdown")
		expect(rules).toContain("including paths like `plans/*.md`")
		expect(rules).toContain("Do not recover by calling `write_to_file`")
	})

	it("requires retry on same pack and forbids create-copy-delete recovery (F-022c)", () => {
		expect(rules).toContain("retry `write_spec` on the **same** pack")
		expect(rules).toContain("do **not** create a second pack, copy content, or `delete_spec` the original")
		expect(rules).toContain("inside the same pack")
	})

	it("states new pack only when user asks for new/separate pack", () => {
		expect(rules).toContain("user asked for a new/separate pack")
		expect(rules).toContain("never create-copy-delete")
	})

	it("still keeps coding on normal project file tools after no-fallback guidance", () => {
		expect(rules).toContain("continue using normal project file tools")
		expect(rules).toContain(
			"Project file tools remain for implementation code/config and only for planning content when the user explicitly requests a project path",
		)
	})
})
