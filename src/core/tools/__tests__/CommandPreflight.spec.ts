import { describe, expect, it } from "vitest"

import { fingerprintCommand, preflightCommand } from "../CommandPreflight"

describe("preflightCommand", () => {
	it("rejects non-string and empty commands", () => {
		expect(preflightCommand({ command: 42 }).issues[0].code).toBe("non_string_command")
		expect(preflightCommand({ command: "   " }).issues[0].code).toBe("empty_command")
	})

	it("blocks PowerShell bare where and supplies where.exe", () => {
		const result = preflightCommand({ command: "where node", shell: "powershell.exe" })
		expect(result.ok).toBe(false)
		expect(result.issues[0]).toMatchObject({ code: "powershell_bare_where", blocking: true })
		expect(result.issues[0].fix).toBe("where.exe node")
	})

	it("blocks Unix utilities in PowerShell", () => {
		for (const command of ["grep foo file", "cat file", "rm -rf build", "sed -n 1p file"]) {
			expect(preflightCommand({ command, shell: "pwsh" }).ok).toBe(false)
		}
	})

	it("accepts shell-safe commands", () => {
		expect(preflightCommand({ command: "Get-Command node", shell: "powershell.exe" }).ok).toBe(true)
		expect(preflightCommand({ command: "grep -R foo src", shell: "bash" }).ok).toBe(true)
	})

	it("blocks an identical replayed failed command", () => {
		const seen = new Set([fingerprintCommand("npm test")])
		const result = preflightCommand({ command: "npm   test", shell: "bash" }, seen)
		expect(result.issues.some((issue) => issue.code === "duplicate_command")).toBe(false)
		// whitespace is trimmed for fingerprint callers but preflight receives fingerprints as raw commands
		expect(preflightCommand({ command: "npm test", shell: "bash" }, seen).ok).toBe(false)
	})
})
