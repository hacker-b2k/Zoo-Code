/**
 * Persistent agent-browser session manager.
 * Starts `agent-browser serve` once as a background process,
 * then routes all subsequent commands via HTTP to avoid terminal spawning.
 *
 * This is the Solution 2 from fix-plan-persistent-terminal.md
 * — eliminates per-command terminal overhead (1,200ms → ~200ms per command).
 */

import { spawn, type ChildProcess } from "child_process"

const AGENT_BROWSER_PORT = 9223
const AGENT_BROWSER_BASE_URL = `http://127.0.0.1:${AGENT_BROWSER_PORT}`
const STARTUP_TIMEOUT_MS = 10_000
const COMMAND_TIMEOUT_MS = 30_000

let serverProcess: ChildProcess | null = null
let serverReady = false
let startupPromise: Promise<void> | null = null

/**
 * Start the agent-browser HTTP server if not already running.
 * Uses a single background process that stays alive for the entire session.
 */
export async function ensureAgentBrowserServer(): Promise<void> {
	if (serverReady) return
	if (startupPromise) return startupPromise

	startupPromise = (async () => {
		try {
			// Check if server is already running (from a previous session)
			const isRunning = await checkServerHealth()
			if (isRunning) {
				serverReady = true
				return
			}

			// Start the server as a detached background process
			serverProcess = spawn("npx", ["agent-browser", "serve", "--port", String(AGENT_BROWSER_PORT)], {
				shell: true,
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			})

			serverProcess.unref()
			serverProcess.on("error", () => {
				serverReady = false
				startupPromise = null
			})

			// Wait for server to become ready
			await waitForServer()
			serverReady = true
		} catch (error) {
			startupPromise = null
			throw error
		}
	})()

	return startupPromise
}

/**
 * Execute an agent-browser command via HTTP instead of CLI.
 * Returns the command output as a string.
 */
export async function executeAgentBrowserCommand(command: string): Promise<string> {
	await ensureAgentBrowserServer()

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS)

	try {
		const response = await fetch(`${AGENT_BROWSER_BASE_URL}/exec`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cmd: command }),
			signal: controller.signal,
		})

		if (!response.ok) {
			throw new Error(`agent-browser HTTP error: ${response.status} ${response.statusText}`)
		}

		const data = (await response.json()) as { stdout?: string; stderr?: string; exitCode?: number }
		if (data.exitCode && data.exitCode !== 0) {
			throw new Error(data.stderr || `Command failed with exit code ${data.exitCode}`)
		}

		return (data.stdout || "").trim()
	} finally {
		clearTimeout(timeout)
	}
}

/**
 * Check if the agent-browser HTTP server is already running.
 */
async function checkServerHealth(): Promise<boolean> {
	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 2000)
		const response = await fetch(`${AGENT_BROWSER_BASE_URL}/health`, { signal: controller.signal })
		clearTimeout(timeout)
		return response.ok
	} catch {
		return false
	}
}

/**
 * Wait for the server to become ready.
 */
async function waitForServer(): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < STARTUP_TIMEOUT_MS) {
		if (await checkServerHealth()) return
		await new Promise((r) => setTimeout(r, 500))
	}
	throw new Error("agent-browser server failed to start within timeout")
}

/**
 * Check if agent-browser serve is available (for capability detection).
 */
export function isAgentBrowserAvailable(): boolean {
	return serverReady
}

/**
 * Stop the agent-browser server (cleanup on extension deactivation).
 */
export function stopAgentBrowserServer(): void {
	if (serverProcess) {
		serverProcess.kill()
		serverProcess = null
		serverReady = false
		startupPromise = null
	}
}
