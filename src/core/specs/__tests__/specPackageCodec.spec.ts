import { describe, expect, it } from "vitest"

import { SPEC_PACKAGE_FORMAT, SPEC_PACKAGE_VERSION, type SpecPackage } from "../package/specPackageTypes"
import {
	MAX_SPEC_PACKAGE_BYTES,
	MAX_SPEC_PACKAGE_DOCUMENTS,
	MAX_SPEC_PACKAGE_DOCUMENT_BYTES,
	computeSpecPackageHash,
	hashSpecPackageContent,
	normalizeImportedDocumentKind,
	parseSpecPackage,
	safePackageDocumentFileName,
	serializeSpecPackage,
} from "../package/specPackageCodec"

describe("F-023 spec package codec", () => {
	const now = Date.now()

	function buildPackage(): Omit<SpecPackage, "packageHash"> {
		return {
			format: SPEC_PACKAGE_FORMAT,
			formatVersion: SPEC_PACKAGE_VERSION,
			exportedAt: now,
			exporter: "zoo-code",
			source: {
				title: "Auth System",
				stage: "design",
				createdAt: now - 1000,
				updatedAt: now - 500,
				schemaVersion: 1,
			},
			documents: [
				{
					id: "requirements",
					kind: "requirements",
					title: "Requirements",
					fileName: "requirements.md",
					revision: 1,
					createdAt: now - 1000,
					updatedAt: now - 500,
					content: "# Requirements\n",
					contentHash: hashSpecPackageContent("# Requirements\n"),
				},
				{
					id: "design",
					kind: "design",
					title: "Design",
					fileName: "design.md",
					revision: 2,
					createdAt: now - 1000,
					updatedAt: now - 400,
					content: "# Design\n",
					contentHash: hashSpecPackageContent("# Design\n"),
				},
			],
		}
	}

	/** Parse the serialized form, mutate one field, re-stringify into raw JSON. */
	function rawFromMutator(mutate: (pkg: any) => void): string {
		const serialized = serializeSpecPackage(buildPackage())
		const parsed = JSON.parse(serialized)
		mutate(parsed)
		return JSON.stringify(parsed)
	}

	describe("round-trip", () => {
		it("serialize + parse preserves docs + meta and recomputes packageHash", () => {
			const pkg = buildPackage()
			const serialized = serializeSpecPackage(pkg)
			const parsed = parseSpecPackage(serialized)

			expect(parsed.documents).toEqual(pkg.documents)
			expect(parsed.source).toEqual(pkg.source)
			expect(parsed.format).toBe(SPEC_PACKAGE_FORMAT)
			expect(parsed.formatVersion).toBe(SPEC_PACKAGE_VERSION)
			expect(parsed.packageHash).toMatch(/^[a-f0-9]{64}$/)
		})

		it("serialized output ends with a trailing newline", () => {
			const serialized = serializeSpecPackage(buildPackage())
			expect(serialized.endsWith("\n")).toBe(true)
		})
	})

	describe("packageHash", () => {
		it("is stable for identical input", () => {
			const pkg = buildPackage()
			expect(computeSpecPackageHash(pkg)).toBe(computeSpecPackageHash(pkg))
		})

		it("changes when content changes", () => {
			const pkg = buildPackage()
			const mutated: typeof pkg = {
				...pkg,
				documents: pkg.documents.map((d) => (d.id === "design" ? { ...d, content: "# Changed Design\n" } : d)),
			}
			expect(computeSpecPackageHash(mutated)).not.toBe(computeSpecPackageHash(pkg))
		})

		it("parse rejects when packageHash present but wrong", () => {
			const serialized = serializeSpecPackage(buildPackage())
			const parsed = JSON.parse(serialized) as SpecPackage
			// Tamper content + its contentHash to stay self-consistent, but leave
			// the stale packageHash. The whole-package hash must mismatch.
			parsed.documents[0].content = "# Tampered\n"
			parsed.documents[0].contentHash = hashSpecPackageContent("# Tampered\n")
			const raw = JSON.stringify(parsed)
			expect(() => parseSpecPackage(raw)).toThrow(/hash mismatch/i)
		})
	})

	describe("validation rejections", () => {
		it("rejects wrong format", () => {
			const raw = rawFromMutator((p) => {
				p.format = "wrong"
			})
			expect(() => parseSpecPackage(raw)).toThrow(/format/i)
		})

		it("rejects wrong formatVersion", () => {
			const raw = rawFromMutator((p) => {
				p.formatVersion = 2
			})
			expect(() => parseSpecPackage(raw)).toThrow(/formatVersion/i)
		})

		it("rejects empty documents array", () => {
			const raw = rawFromMutator((p) => {
				p.documents = []
			})
			expect(() => parseSpecPackage(raw)).toThrow(/at least one document/i)
		})

		it("rejects duplicate document id", () => {
			const raw = rawFromMutator((p) => {
				p.documents[1].id = p.documents[0].id
			})
			expect(() => parseSpecPackage(raw)).toThrow(/duplicate.*id/i)
		})

		it("rejects duplicate document fileName (case-insensitive)", () => {
			const raw = rawFromMutator((p) => {
				p.documents[1].fileName = p.documents[0].fileName.toUpperCase()
			})
			expect(() => parseSpecPackage(raw)).toThrow(/duplicate.*fileName/i)
		})

		it("rejects non-integer or zero revision", () => {
			const rawInt = rawFromMutator((p) => {
				p.documents[0].revision = 0
			})
			expect(() => parseSpecPackage(rawInt)).toThrow(/revision/i)

			const rawFloat = rawFromMutator((p) => {
				p.documents[0].revision = 1.5
			})
			expect(() => parseSpecPackage(rawFloat)).toThrow(/revision/i)
		})

		it("rejects contentHash mismatch", () => {
			const raw = rawFromMutator((p) => {
				p.documents[0].content = "# Tampered\n"
				// contentHash stays old (mismatch)
			})
			expect(() => parseSpecPackage(raw)).toThrow(/document hash mismatch/i)
		})

		it("rejects invalid exportedAt", () => {
			const rawNaN = rawFromMutator((p) => {
				p.exportedAt = NaN
			})
			expect(() => parseSpecPackage(rawNaN)).toThrow(/exportedAt/i)

			const rawNeg = rawFromMutator((p) => {
				p.exportedAt = -1
			})
			expect(() => parseSpecPackage(rawNeg)).toThrow(/exportedAt/i)
		})

		it("rejects empty exporter", () => {
			const raw = rawFromMutator((p) => {
				p.exporter = "  "
			})
			expect(() => parseSpecPackage(raw)).toThrow(/exporter/i)
		})

		it("rejects invalid source stage", () => {
			const raw = rawFromMutator((p) => {
				p.source.stage = "draft"
			})
			expect(() => parseSpecPackage(raw)).toThrow(/stage/i)
		})

		it("rejects invalid source schemaVersion", () => {
			const rawZero = rawFromMutator((p) => {
				p.source.schemaVersion = 0
			})
			expect(() => parseSpecPackage(rawZero)).toThrow(/schemaVersion/i)

			const rawFloat = rawFromMutator((p) => {
				p.source.schemaVersion = 1.5
			})
			expect(() => parseSpecPackage(rawFloat)).toThrow(/schemaVersion/i)
		})

		it("rejects package exceeding MAX_SPEC_PACKAGE_BYTES", () => {
			const hugeRaw = "x".repeat(MAX_SPEC_PACKAGE_BYTES + 1)
			expect(() => parseSpecPackage(hugeRaw)).toThrow(/byte limit/i)
		})

		it("rejects package exceeding MAX_SPEC_PACKAGE_DOCUMENTS", () => {
			const raw = rawFromMutator((p) => {
				const template = p.documents[0]
				p.documents = []
				for (let i = 0; i < MAX_SPEC_PACKAGE_DOCUMENTS + 1; i++) {
					const content = `# Doc ${i}\n`
					p.documents.push({
						...template,
						id: `doc-${i}`,
						fileName: `doc-${i}.md`,
						content,
						contentHash: hashSpecPackageContent(content),
					})
				}
			})
			expect(() => parseSpecPackage(raw)).toThrow(/document limit/i)
		})

		it("rejects single document exceeding MAX_SPEC_PACKAGE_DOCUMENT_BYTES", () => {
			const raw = rawFromMutator((p) => {
				const bigContent = "x".repeat(MAX_SPEC_PACKAGE_DOCUMENT_BYTES + 1)
				p.documents[0].content = bigContent
				p.documents[0].contentHash = hashSpecPackageContent(bigContent)
			})
			expect(() => parseSpecPackage(raw)).toThrow(/byte limit/i)
		})
	})

	describe("normalizeImportedDocumentKind", () => {
		it("returns known kinds unchanged", () => {
			const known = ["requirements", "design", "tasks", "notes", "custom"]
			for (const kind of known) {
				expect(normalizeImportedDocumentKind(kind)).toBe(kind)
			}
		})

		it("maps unknown kinds to custom", () => {
			expect(normalizeImportedDocumentKind("roadmap")).toBe("custom")
			expect(normalizeImportedDocumentKind("")).toBe("custom")
			expect(normalizeImportedDocumentKind("ARCHITECTURE")).toBe("custom")
		})
	})

	describe("safePackageDocumentFileName", () => {
		it("keeps a safe basename", () => {
			const result = safePackageDocumentFileName("requirements.md", "requirements", "requirements")
			expect(result).toBe("requirements.md")
		})

		it("produces a safe name for unsafe input (no path separators, no ..)", () => {
			const result = safePackageDocumentFileName("../evil.md", "custom", "x1")
			expect(result).toMatch(/^[a-zA-Z0-9._-]+\.md$/)
			expect(result).not.toContain("/")
			expect(result).not.toContain("\\")
			expect(result).not.toContain("..")
		})

		it("falls back to kind-based name when fileName is empty", () => {
			const result = safePackageDocumentFileName("", "custom", "custom-1")
			expect(result).toBe("custom-1.md")
		})
	})
})
