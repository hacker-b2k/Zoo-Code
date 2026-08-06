export type ShellKind = "powershell" | "cmd" | "posix"

export interface PreflightInput {
	command: unknown
	cwd?: string
	shell?: string
}

export type PreflightIssue = {
	code:
		| "empty_command"
		| "non_string_command"
		| "powershell_bare_where"
		| "unix_tool_in_powershell"
		| "duplicate_command"
	message: string
	fix?: string
	blocking: boolean
}

export interface PreflightResult {
	ok: boolean
	command: string
	changed: boolean
	issues: PreflightIssue[]
	detectedShell: ShellKind
}

const UNIX_TOOLS = ["sed", "grep", "awk", "cat", "rm", "cp", "mv"]

export function detectShell(shell?: string): ShellKind {
	const normalized = (shell ?? "").toLowerCase()
	if (normalized.includes("powershell") || normalized.includes("pwsh")) return "powershell"
	if (normalized.includes("cmd")) return "cmd"
	return "posix"
}

export function preflightCommand(
	input: PreflightInput,
	priorFingerprints: ReadonlySet<string> = new Set(),
): PreflightResult {
	const issues: PreflightIssue[] = []
	const detectedShellEarly = detectShell(input.shell)
	if (typeof input.command !== "string") {
		return {
			ok: false,
			command: "",
			changed: false,
			issues: [
				{ code: "non_string_command", message: "execute_command.command must be a string", blocking: true },
			],
			detectedShell: detectedShellEarly,
		}
	}

	const command = input.command.trim()
	if (!command) {
		return {
			ok: false,
			command: "",
			changed: false,
			issues: [{ code: "empty_command", message: "execute_command.command cannot be empty", blocking: true }],
			detectedShell: detectedShellEarly,
		}
	}

	const shell = detectShell(input.shell)
	const detectedShell = shell
	if (shell === "powershell") {
		if (/(^|[;&|]\s*|[^\w])where\s+[A-Za-z_]/.test(command)) {
			issues.push({
				code: "powershell_bare_where",
				message: "PowerShell `where` is Where-Object, not where.exe. Use `where.exe` or `Get-Command`.",
				fix: command.replace(/(^|[;&|]\s*|[^\w])where\s+/gm, "$1where.exe "),
				blocking: true,
			})
		}
		for (const tool of UNIX_TOOLS) {
			if (new RegExp(`(^|[;&|]\\s*)${tool}\\s+`).test(command)) {
				issues.push({
					code: "unix_tool_in_powershell",
					message: `Unix utility ${tool} is not portable to PowerShell. Use the native PowerShell equivalent.`,
					blocking: true,
				})
			}
		}
	}

	if (priorFingerprints.has(command)) {
		issues.push({
			code: "duplicate_command",
			message:
				"Identical failed command was already executed this turn; change the command or gather new evidence before retrying.",
			blocking: true,
		})
	}

	return { ok: issues.every((issue) => !issue.blocking), command, changed: false, issues, detectedShell }
}

export function fingerprintCommand(command: string): string {
	return command.trim().replace(/\s+/g, " ")
}
