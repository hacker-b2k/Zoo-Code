import * as path from "path"
import * as vscode from "vscode"
import { spawn } from "child_process"
import fs from "fs/promises"

export type PreferredBrowser = "auto" | "chrome" | "edge"

const WINDOWS_BROWSER_CANDIDATES: Record<Exclude<PreferredBrowser, "auto">, string[]> = {
	chrome: [
		path.join("C:", "Program Files", "Google", "Chrome", "Application", "chrome.exe"),
		path.join("C:", "Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
	],
	edge: [
		path.join("C:", "Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
		path.join("C:", "Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
	],
}

export interface OpenTabsOptions {
	urls: string[]
	browser?: PreferredBrowser
	reuseExisting?: boolean
	visible?: boolean
}

export interface OpenTabsResult {
	browserUsed: PreferredBrowser | "default"
	urls: string[]
	openedCount: number
	usedExternalFallback: boolean
}

export function normalizeAndValidateUrls(urls: string[]): string[] {
	return urls
		.map((url) => (typeof url === "string" ? url.trim() : ""))
		.filter(Boolean)
		.filter((url) => {
			try {
				const parsed = new URL(url)
				return parsed.protocol === "http:" || parsed.protocol === "https:"
			} catch {
				return false
			}
		})
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

export async function resolveBrowserExecutable(
	browser: PreferredBrowser,
): Promise<{ browserUsed: PreferredBrowser; executable: string } | undefined> {
	const order: Exclude<PreferredBrowser, "auto">[] = browser === "auto" ? ["chrome", "edge"] : [browser]

	for (const candidateBrowser of order) {
		for (const candidatePath of WINDOWS_BROWSER_CANDIDATES[candidateBrowser]) {
			if (await fileExists(candidatePath)) {
				return { browserUsed: candidateBrowser, executable: candidatePath }
			}
		}
	}

	return undefined
}

export async function openTabs(options: OpenTabsOptions): Promise<OpenTabsResult> {
	const browser = options.browser ?? "auto"
	const urls = normalizeAndValidateUrls(options.urls)

	if (urls.length === 0) {
		throw new Error("No valid absolute http/https URLs were provided.")
	}

	if (process.platform === "win32") {
		const resolved = await resolveBrowserExecutable(browser)
		if (resolved) {
			const child = spawn(resolved.executable, urls, {
				detached: true,
				stdio: "ignore",
				windowsHide: false,
			})
			child.unref()
			return {
				browserUsed: resolved.browserUsed,
				urls,
				openedCount: urls.length,
				usedExternalFallback: false,
			}
		}
	}

	await Promise.all(urls.map((url) => vscode.env.openExternal(vscode.Uri.parse(url))))
	return {
		browserUsed: "default",
		urls,
		openedCount: urls.length,
		usedExternalFallback: true,
	}
}
