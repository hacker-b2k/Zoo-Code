/**
 * Issue A regression: the Mermaid renderer bundled for the Spec Workspace
 * preview must be a current v11+ release — never an outdated v9/v10.
 *
 * Investigation finding: the preview loads `dist/mermaid.min.js`, which the
 * esbuild config copies verbatim from
 * `webview-ui/node_modules/mermaid/dist/mermaid.min.js`. That dependency is
 * pinned at 11.16.0 (the latest stable at time of writing), so the earlier
 * "renderer is on v9/v10" diagnosis was incorrect — the rendering failures
 * seen in the field were model-generated syntax errors and the (now fixed)
 * parse-before-render false-negative, not an outdated library.
 *
 * This suite locks the contract so a future downgrade or a stale vendored
 * copy is caught immediately, and documents the upgrade path.
 */

import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"

// __dirname = src/core/specs/ui/__tests__  →  4 levels up = src/
const WEBVIEW_UI = path.resolve(__dirname, "..", "..", "..", "..", "..", "webview-ui")
const SRC = path.resolve(__dirname, "..", "..", "..", "..")

function readMermaidVersionFromPackage(): string {
	const pkgPath = path.join(WEBVIEW_UI, "node_modules", "mermaid", "package.json")
	expect(fs.existsSync(pkgPath), `mermaid package.json must exist at ${pkgPath}`).toBe(true)
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
	return pkg.version as string
}

describe("Issue A — bundled Mermaid version", () => {
	it("webview-ui declares mermaid ^11 (v11+)", () => {
		const pkgPath = path.join(WEBVIEW_UI, "package.json")
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
		const declared = pkg.dependencies?.mermaid ?? pkg.devDependencies?.mermaid
		expect(declared, "webview-ui must depend on mermaid").toBeTruthy()
		expect(declared).toMatch(/^\^?11\./)
	})

	it("installed mermaid (source of dist/mermaid.min.js) is v11 or later", () => {
		const version = readMermaidVersionFromPackage()
		const major = parseInt(version.split(".")[0], 10)
		expect(major, `mermaid ${version} must be v11+ (found major ${major})`).toBeGreaterThanOrEqual(11)
	})

	it("the esbuild build copies mermaid from the v11 node_modules source (not a stale vendored file)", () => {
		// Guards the upgrade path: dist/mermaid.min.js is always regenerated
		// from the installed dependency, never a hand-pinned older copy.
		const esbuildPath = path.join(SRC, "esbuild.mjs")
		const esbuild = fs.readFileSync(esbuildPath, "utf8")
		for (const segment of ["webview-ui", "node_modules", "mermaid", "dist", "mermaid.min.js"]) {
			expect(esbuild, `esbuild.mjs must source mermaid from ${segment}`).toContain(`"${segment}"`)
		}
	})
})
