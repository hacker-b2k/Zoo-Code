// npx vitest __tests__/dist_assets.spec.ts

import * as fs from "fs"
import * as path from "path"
import * as yaml from "yaml"

describe("dist assets", () => {
	const distPath = path.join(__dirname, "../dist")
	const marketplaceAssetsPath = path.join(distPath, "assets/marketplace")
	const packageJsonPath = path.join(__dirname, "../package.json")
	const activityBarIconPath = path.join(__dirname, "../assets/icons/icon.svg")
	const brandLogoPath = path.join(__dirname, "../assets/images/roo-logo.svg")

	describe("tiktoken", () => {
		it("should have tiktoken wasm file", () => {
			expect(fs.existsSync(path.join(distPath, "tiktoken_bg.wasm"))).toBe(true)
		})
	})

	describe("tree-sitter", () => {
		const treeSitterFiles = [
			"tree-sitter-bash.wasm",
			"tree-sitter-cpp.wasm",
			"tree-sitter-c_sharp.wasm",
			"tree-sitter-css.wasm",
			"tree-sitter-c.wasm",
			"tree-sitter-elisp.wasm",
			"tree-sitter-elixir.wasm",
			"tree-sitter-elm.wasm",
			"tree-sitter-embedded_template.wasm",
			"tree-sitter-go.wasm",
			"tree-sitter-html.wasm",
			"tree-sitter-javascript.wasm",
			"tree-sitter-java.wasm",
			"tree-sitter-json.wasm",
			"tree-sitter-kotlin.wasm",
			"tree-sitter-lua.wasm",
			"tree-sitter-objc.wasm",
			"tree-sitter-ocaml.wasm",
			"tree-sitter-php.wasm",
			"tree-sitter-python.wasm",
			"tree-sitter-ql.wasm",
			"tree-sitter-rescript.wasm",
			"tree-sitter-ruby.wasm",
			"tree-sitter-rust.wasm",
			"tree-sitter-scala.wasm",
			"tree-sitter-solidity.wasm",
			"tree-sitter-swift.wasm",
			"tree-sitter-systemrdl.wasm",
			"tree-sitter-tlaplus.wasm",
			"tree-sitter-toml.wasm",
			"tree-sitter-tsx.wasm",
			"tree-sitter-typescript.wasm",
			"tree-sitter-vue.wasm",
			"tree-sitter.wasm",
			"tree-sitter-yaml.wasm",
			"tree-sitter-zig.wasm",
		]

		test.each(treeSitterFiles)("should have %s file", (filename) => {
			expect(fs.existsSync(path.join(distPath, filename))).toBe(true)
		})
	})

	describe("marketplace assets", () => {
		const marketplaceFiles = ["modes.yml", "mcps.yml"]

		test.each(marketplaceFiles)("should include bundled %s marketplace asset with multiple items", (filename) => {
			const assetPath = path.join(marketplaceAssetsPath, filename)
			expect(fs.existsSync(assetPath)).toBe(true)

			const parsed = yaml.parse(fs.readFileSync(assetPath, "utf-8"))
			expect(Array.isArray(parsed?.items)).toBe(true)
			expect(parsed.items.length).toBeGreaterThan(1)
		})
	})

	describe("activity bar icon", () => {
		it("should point the activity bar contribution at the dedicated icon asset", () => {
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
			const activityBarContainers = packageJson.contributes?.viewsContainers?.activitybar

			expect(activityBarContainers).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: "zoo-code-ActivityBar",
						icon: "assets/icons/icon.svg",
					}),
				]),
			)
		})

		it("should keep a compact dedicated activity bar svg instead of the full brand artwork", () => {
			const iconSvg = fs.readFileSync(activityBarIconPath, "utf-8")
			const brandLogoSvg = fs.readFileSync(brandLogoPath, "utf-8")

			expect(iconSvg).not.toEqual(brandLogoSvg)
			expect(iconSvg).toContain('viewBox="0 0 96 96"')
			expect(iconSvg.length).toBeLessThan(5000)
		})
	})
})
