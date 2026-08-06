import { describe, it, expect } from "vitest"
import {
	defaultIntentForSource,
	resolveDisabledOnAdmission,
	applyActivationPolicy,
	shouldStartMcpProcess,
	resolveDisableStartReason,
} from "../mcpLifecyclePolicy"

describe("mcpLifecyclePolicy", () => {
	describe("defaultIntentForSource", () => {
		it("always returns install_only", () => {
			expect(defaultIntentForSource("marketplace")).toBe("install_only")
			expect(defaultIntentForSource("agent")).toBe("install_only")
			expect(defaultIntentForSource("unknown")).toBe("install_only")
		})
	})

	describe("raw_load", () => {
		it("treats missing disabled as enabled", () => {
			expect(
				resolveDisabledOnAdmission(
					{ command: "npx" },
					{ mode: "raw_load", sourceKind: "unknown", isNew: false },
				),
			).toBe(false)
		})

		it("respects disabled true", () => {
			expect(
				resolveDisabledOnAdmission(
					{ command: "npx", disabled: true },
					{ mode: "raw_load", sourceKind: "git", isNew: false },
				),
			).toBe(true)
		})
	})

	describe("managed_admission", () => {
		it("install_only forces disabled true", () => {
			const result = applyActivationPolicy(
				{ command: "npx", disabled: false },
				{
					mode: "managed_admission",
					sourceKind: "marketplace",
					intent: "install_only",
					isNew: true,
				},
			)
			expect(result.disabled).toBe(true)
		})

		it("start forces disabled false", () => {
			const result = applyActivationPolicy(
				{ command: "npx", disabled: true },
				{
					mode: "managed_admission",
					sourceKind: "agent",
					intent: "start",
					isNew: true,
				},
			)
			expect(result.disabled).toBe(false)
		})

		it("preserve keeps previous disabled", () => {
			expect(
				resolveDisabledOnAdmission(
					{ command: "npx" },
					{
						mode: "managed_admission",
						sourceKind: "marketplace",
						intent: "preserve",
						isNew: false,
						previous: { disabled: false },
					},
				),
			).toBe(false)
		})

		it("defaults to install_only when intent omitted", () => {
			expect(
				resolveDisabledOnAdmission(
					{ command: "npx" },
					{ mode: "managed_admission", sourceKind: "import", isNew: true },
				),
			).toBe(true)
		})
	})

	describe("shouldStartMcpProcess", () => {
		it("starts only when enabled and not server-disabled", () => {
			expect(shouldStartMcpProcess({ mcpEnabled: true, serverDisabled: false })).toBe(true)
			expect(shouldStartMcpProcess({ mcpEnabled: false, serverDisabled: false })).toBe(false)
			expect(shouldStartMcpProcess({ mcpEnabled: true, serverDisabled: true })).toBe(false)
			expect(shouldStartMcpProcess({ mcpEnabled: false, serverDisabled: true })).toBe(false)
		})
	})

	describe("resolveDisableStartReason", () => {
		it("prefers global MCP disabled", () => {
			expect(resolveDisableStartReason({ mcpEnabled: false, serverDisabled: true })).toBe("mcpDisabled")
			expect(resolveDisableStartReason({ mcpEnabled: true, serverDisabled: true })).toBe("serverDisabled")
			expect(resolveDisableStartReason({ mcpEnabled: true, serverDisabled: false })).toBeNull()
		})
	})
})
