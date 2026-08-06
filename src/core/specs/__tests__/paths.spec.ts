import { describe, it, expect } from "vitest"
import * as path from "path"
import * as os from "os"

import {
	assertPathInsideBase,
	assertSafeDocFileName,
	assertSafeId,
	coerceOptionalSpecId,
	hashWorkspaceRoot,
	isPathInsideWorkspace,
	isTruncatedDisplaySpecId,
	normalizeWorkspaceRoot,
	relativePathInsideWorkspace,
	truncatedSpecIdErrorMessage,
} from "../paths"

describe("normalizeWorkspaceRoot / hashWorkspaceRoot", () => {
	it("produces stable hashes for equivalent Windows-style roots", () => {
		const a = hashWorkspaceRoot("C:\\Users\\dev\\project")
		const b = hashWorkspaceRoot("c:/Users/dev/project")
		const c = hashWorkspaceRoot("C:/Users/dev/project/")
		expect(a).toBe(b)
		expect(b).toBe(c)
		expect(a).toHaveLength(16)
	})

	it("produces different hashes for different roots", () => {
		const a = hashWorkspaceRoot("/tmp/project-a")
		const b = hashWorkspaceRoot("/tmp/project-b")
		expect(a).not.toBe(b)
	})

	it("rejects empty workspaceRoot", () => {
		expect(() => normalizeWorkspaceRoot("")).toThrow(/required/)
		expect(() => hashWorkspaceRoot("   ")).toThrow(/required/)
	})

	it("resolves relative segments", () => {
		const root = path.join(os.tmpdir(), "spec-hash-test")
		const hash = hashWorkspaceRoot(path.join(root, "sub", ".."))
		expect(hash).toBe(hashWorkspaceRoot(root))
	})
})

describe("relativePathInsideWorkspace / isPathInsideWorkspace (export/import containment)", () => {
	it("accepts nested folders inside the workspace root", () => {
		const root = path.join(os.tmpdir(), "zoo-ws-root")
		const nested = path.join(root, "docs", "design")
		expect(relativePathInsideWorkspace(root, nested)).toBe("docs/design")
		expect(relativePathInsideWorkspace(root, root)).toBe("")
		expect(isPathInsideWorkspace(root, nested)).toBe(true)
	})

	it("rejects paths outside the workspace", () => {
		const root = path.join(os.tmpdir(), "zoo-ws-root-a")
		const outside = path.join(os.tmpdir(), "zoo-ws-root-b", "docs")
		expect(relativePathInsideWorkspace(root, outside)).toBeNull()
		expect(isPathInsideWorkspace(root, outside)).toBe(false)
	})

	it("handles trailing slashes and mixed separators", () => {
		const root = path.join(os.tmpdir(), "zoo-ws-slash")
		const nested = path.join(root, "architecture") + path.sep
		const rel = relativePathInsideWorkspace(root + path.sep, nested)
		expect(rel).toBe("architecture")
	})

	it("accepts Windows-style drive letter case mismatch when paths are otherwise nested", () => {
		// Simulate the post-F-010 UI bug: workspace root and picker path differ only by drive case.
		const root = "C:\\Users\\dev\\project"
		const nested = "c:\\Users\\dev\\project\\docs"
		const rel = relativePathInsideWorkspace(root, nested)
		if (process.platform === "win32") {
			expect(rel).toBe("docs")
			expect(isPathInsideWorkspace(root, nested)).toBe(true)
		} else {
			// On POSIX, C:\... is not a real drive path; still must not throw.
			expect(rel === null || typeof rel === "string").toBe(true)
		}
	})
})

describe("assertSafeId / assertSafeDocFileName / assertPathInsideBase", () => {
	it("accepts uuid-like and simple ids", () => {
		expect(() => assertSafeId("a1b2c3d4-e5f6-7890-abcd-ef1234567890", "specId")).not.toThrow()
		expect(() => assertSafeId("requirements", "docId")).not.toThrow()
	})

	it("rejects path traversal ids", () => {
		expect(() => assertSafeId("../evil", "specId")).toThrow()
		expect(() => assertSafeId("foo/bar", "specId")).toThrow()
		expect(() => assertSafeId("", "specId")).toThrow()
	})

	it("accepts safe markdown basenames only", () => {
		expect(() => assertSafeDocFileName("requirements.md")).not.toThrow()
		expect(() => assertSafeDocFileName("../x.md")).toThrow()
		expect(() => assertSafeDocFileName("sub/req.md")).toThrow()
		expect(() => assertSafeDocFileName("nope.txt")).toThrow()
	})

	it("rejects targets outside base", () => {
		const base = path.join(os.tmpdir(), "specs-base")
		expect(() => assertPathInsideBase(base, path.join(base, "ok.md"))).not.toThrow()
		expect(() => assertPathInsideBase(base, path.join(base, "..", "outside.md"))).toThrow(/outside specs storage/)
	})
})

describe("coerceOptionalSpecId (F-005e)", () => {
	it("maps null/undefined/empty/sentinel strings to null", () => {
		expect(coerceOptionalSpecId(null)).toBeNull()
		expect(coerceOptionalSpecId(undefined)).toBeNull()
		expect(coerceOptionalSpecId("")).toBeNull()
		expect(coerceOptionalSpecId("   ")).toBeNull()
		expect(coerceOptionalSpecId("null")).toBeNull()
		expect(coerceOptionalSpecId("NULL")).toBeNull()
		expect(coerceOptionalSpecId(" Null ")).toBeNull()
		expect(coerceOptionalSpecId("undefined")).toBeNull()
		expect(coerceOptionalSpecId("UNDEFINED")).toBeNull()
		// Python-style / other sentinels (ISSUES_REPORT §1.1)
		expect(coerceOptionalSpecId("None")).toBeNull()
		expect(coerceOptionalSpecId("none")).toBeNull()
		expect(coerceOptionalSpecId("NIL")).toBeNull()
	})

	it("preserves real spec ids trimmed", () => {
		expect(coerceOptionalSpecId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(
			"a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		)
		expect(coerceOptionalSpecId("  real-id  ")).toBe("real-id")
	})

	it("maps non-string values to null", () => {
		expect(coerceOptionalSpecId(0)).toBeNull()
		expect(coerceOptionalSpecId({})).toBeNull()
	})

	it("detects truncated display spec ids (F-006b)", () => {
		expect(isTruncatedDisplaySpecId("9b09f722…")).toBe(true)
		expect(isTruncatedDisplaySpecId("9b09f722...")).toBe(true)
		expect(isTruncatedDisplaySpecId("  abcdef12…  ")).toBe(true)
		expect(isTruncatedDisplaySpecId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(false)
		expect(isTruncatedDisplaySpecId(null)).toBe(false)
		expect(isTruncatedDisplaySpecId("")).toBe(false)
		expect(truncatedSpecIdErrorMessage("9b09f722…")).toContain("list_specs")
		expect(truncatedSpecIdErrorMessage("9b09f722…")).toContain("spec_id: null")
		// coerce keeps truncated string so tools can reject (does not map to null)
		expect(coerceOptionalSpecId("9b09f722…")).toBe("9b09f722…")
	})
})
