// npx vitest run integrations/terminal/__tests__/ExecaTerminalProcess.spec.ts

const mockPid = 12345

vitest.mock("execa", () => {
	const mockKill = vitest.fn()
	const execa = vitest.fn(function (options: any) {
		return (_template: TemplateStringsArray, ...args: any[]) => ({
			pid: mockPid,
			iterable: (_opts: any) =>
				(async function* () {
					yield "test output\n"
				})(),
			kill: mockKill,
		})
	})
	return { execa, ExecaError: class extends Error {} }
})

vitest.mock("ps-tree", () => ({
	default: vitest.fn(function (_: number, cb: any) {
		return cb(null, [])
	}),
}))

import { execa } from "execa"
import { ExecaTerminalProcess } from "../ExecaTerminalProcess"
import { BaseTerminal } from "../BaseTerminal"
import type { RooTerminal } from "../types"

describe("ExecaTerminalProcess", () => {
	let mockTerminal: RooTerminal
	let terminalProcess: ExecaTerminalProcess
	let originalEnv: NodeJS.ProcessEnv

	beforeEach(() => {
		originalEnv = { ...process.env }
		BaseTerminal.setExecaShellPath(undefined)
		mockTerminal = {
			provider: "execa",
			id: 1,
			busy: false,
			running: false,
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/cwd"),
			isClosed: vitest.fn().mockReturnValue(false),
			runCommand: vitest.fn(),
			setActiveStream: vitest.fn(),
			shellExecutionComplete: vitest.fn(),
			getProcessesWithOutput: vitest.fn().mockReturnValue([]),
			getUnretrievedOutput: vitest.fn().mockReturnValue(""),
			getLastCommand: vitest.fn().mockReturnValue(""),
			cleanCompletedProcessQueue: vitest.fn(),
		} as unknown as RooTerminal
		terminalProcess = new ExecaTerminalProcess(mockTerminal)
	})

	afterEach(() => {
		process.env = originalEnv
		vitest.clearAllMocks()
	})

	describe("UTF-8 encoding fix", () => {
		it("should set LANG and LC_ALL to en_US.UTF-8", async () => {
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				expect.objectContaining({
					// Problem C: on Windows the shell is now PowerShell path; on other
					// platforms it stays `true`. Only assert the UTF-8 env, not the shell.
					cwd: "/test/cwd",
					all: true,
					env: expect.objectContaining({
						LANG: "en_US.UTF-8",
						LC_ALL: "en_US.UTF-8",
					}),
				}),
			)
		})

		it("should preserve existing environment variables", async () => {
			process.env.EXISTING_VAR = "existing"
			terminalProcess = new ExecaTerminalProcess(mockTerminal)
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			const calledOptions = execaMock.mock.calls[0][0] as any
			expect(calledOptions.env.EXISTING_VAR).toBe("existing")
		})

		it("should override existing LANG and LC_ALL values", async () => {
			process.env.LANG = "C"
			process.env.LC_ALL = "POSIX"
			terminalProcess = new ExecaTerminalProcess(mockTerminal)
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			const calledOptions = execaMock.mock.calls[0][0] as any
			expect(calledOptions.env.LANG).toBe("en_US.UTF-8")
			expect(calledOptions.env.LC_ALL).toBe("en_US.UTF-8")
		})

		it("should use execaShellPath when set", async () => {
			BaseTerminal.setExecaShellPath("/bin/bash")
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				expect.objectContaining({
					shell: "/bin/bash",
				}),
			)
		})

		it("should fall back to shell=true when execaShellPath is undefined (non-Windows)", async () => {
			// On non-Windows (Linux/macOS in CI), no PowerShell resolution runs,
			// so execa gets shell:true. On Windows in CI the actual powershell.exe
			// probe may find PS; we only assert the non-Windows behavior here.
			if (process.platform === "win32") {
				// On Windows, PowerShell is found → shell won't be `true`. Skip.
				return
			}
			BaseTerminal.setExecaShellPath(undefined)
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				expect.objectContaining({
					shell: true,
				}),
			)
		})

		// Problem C regression: on Windows, ExecaTerminalProcess MUST pass an
		// explicit PowerShell shell path to execa — otherwise execa falls through
		// to ComSpec/cmd.exe and PowerShell cmdlets fail.
		it("Problem C: on Windows with no execaShellPath, passes PowerShell path via BaseTerminal.resolveDefaultWindowsShellPath", async () => {
			const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
			Object.defineProperty(process, "platform", { value: "win32", configurable: true })

			const resolveSpy = vitest
				.spyOn(BaseTerminal, "resolveDefaultWindowsShellPath")
				.mockReturnValue("C:\\Program Files\\PowerShell\\7\\pwsh.exe")

			try {
				BaseTerminal.setExecaShellPath(undefined)
				terminalProcess = new ExecaTerminalProcess(mockTerminal)
				await terminalProcess.run("Remove-Item foo")
				const calledOptions = vitest.mocked(execa).mock.calls.at(-1)![0] as any
				expect(calledOptions.shell).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
				expect(calledOptions.shell).not.toBe(true)
			} finally {
				resolveSpy.mockRestore()
				if (originalPlatform) {
					Object.defineProperty(process, "platform", originalPlatform)
				} else {
					Object.defineProperty(process, "platform", { value: "linux", configurable: true })
				}
			}
		})

		it("Problem C: respects user-configured execaShellPath (never overrides with PowerShell)", async () => {
			const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
			Object.defineProperty(process, "platform", { value: "win32", configurable: true })

			const resolveSpy = vitest.spyOn(BaseTerminal, "resolveDefaultWindowsShellPath")

			try {
				BaseTerminal.setExecaShellPath("/usr/bin/zsh") // explicit override
				terminalProcess = new ExecaTerminalProcess(mockTerminal)
				await terminalProcess.run("echo test")
				// User's override must be used; resolveDefaultWindowsShellPath not called
				expect(resolveSpy).not.toHaveBeenCalled()
				const calledOptions = vitest.mocked(execa).mock.calls.at(-1)![0] as any
				expect(calledOptions.shell).toBe("/usr/bin/zsh")
			} finally {
				BaseTerminal.setExecaShellPath(undefined)
				resolveSpy.mockRestore()
				if (originalPlatform) {
					Object.defineProperty(process, "platform", originalPlatform)
				} else {
					Object.defineProperty(process, "platform", { value: "linux", configurable: true })
				}
			}
		})

		it("Problem C: when resolveDefaultWindowsShellPath returns undefined, falls back to shell=true", async () => {
			const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
			Object.defineProperty(process, "platform", { value: "win32", configurable: true })

			const resolveSpy = vitest.spyOn(BaseTerminal, "resolveDefaultWindowsShellPath").mockReturnValue(undefined)

			try {
				BaseTerminal.setExecaShellPath(undefined)
				terminalProcess = new ExecaTerminalProcess(mockTerminal)
				await terminalProcess.run("dir")
				const calledOptions = vitest.mocked(execa).mock.calls.at(-1)![0] as any
				expect(calledOptions.shell).toBe(true)
			} finally {
				resolveSpy.mockRestore()
				if (originalPlatform) {
					Object.defineProperty(process, "platform", originalPlatform)
				} else {
					Object.defineProperty(process, "platform", { value: "linux", configurable: true })
				}
			}
		})
	})

	describe("basic functionality", () => {
		it("should create instance with terminal reference", () => {
			expect(terminalProcess).toBeInstanceOf(ExecaTerminalProcess)
			expect(terminalProcess.terminal).toBe(mockTerminal)
		})

		it("should emit shell_execution_complete with exitCode 0", async () => {
			const spy = vitest.fn()
			terminalProcess.on("shell_execution_complete", spy)
			await terminalProcess.run("echo test")
			expect(spy).toHaveBeenCalledWith({ exitCode: 0 })
		})

		it("should emit completed event with full output", async () => {
			const spy = vitest.fn()
			terminalProcess.on("completed", spy)
			await terminalProcess.run("echo test")
			expect(spy).toHaveBeenCalledWith("test output\n")
		})

		it("should set and clear active stream", async () => {
			await terminalProcess.run("echo test")
			expect(mockTerminal.setActiveStream).toHaveBeenCalledWith(expect.any(Object), mockPid)
			expect(mockTerminal.setActiveStream).toHaveBeenLastCalledWith(undefined)
		})
	})

	describe("trimRetrievedOutput", () => {
		it("clears buffer when all output has been retrieved", () => {
			// Set up a scenario where all output has been retrieved
			terminalProcess["fullOutput"] = "test output data"
			terminalProcess["lastRetrievedIndex"] = 16 // Same as fullOutput.length

			// Access the protected method through type casting
			;(terminalProcess as any).trimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})

		it("does not clear buffer when there is unretrieved output", () => {
			// Set up a scenario where not all output has been retrieved
			terminalProcess["fullOutput"] = "test output data"
			terminalProcess["lastRetrievedIndex"] = 5 // Less than fullOutput.length
			;(terminalProcess as any).trimRetrievedOutput()

			// Buffer should NOT be cleared - there's still unretrieved content
			expect(terminalProcess["fullOutput"]).toBe("test output data")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(5)
		})

		it("does nothing when buffer is already empty", () => {
			terminalProcess["fullOutput"] = ""
			terminalProcess["lastRetrievedIndex"] = 0
			;(terminalProcess as any).trimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})

		it("clears buffer when lastRetrievedIndex exceeds fullOutput length", () => {
			// Edge case: index is greater than current length (could happen if output was modified)
			terminalProcess["fullOutput"] = "short"
			terminalProcess["lastRetrievedIndex"] = 100
			;(terminalProcess as any).trimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})
	})
})
