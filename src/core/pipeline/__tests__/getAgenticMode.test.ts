import { describe, it, expect, vi } from "vitest"

import { getAgenticMode } from "../getAgenticMode"

function makeProvider(value: unknown) {
	return {
		getValue: vi.fn().mockReturnValue(value),
	} as unknown as Parameters<typeof getAgenticMode>[0]
}

describe("getAgenticMode", () => {
	it("returns 'classic' when value is missing", () => {
		const provider = makeProvider(undefined)
		expect(getAgenticMode(provider)).toBe("classic")
	})

	it("returns 'classic' when value is 'classic'", () => {
		const provider = makeProvider("classic")
		expect(getAgenticMode(provider)).toBe("classic")
	})

	it("returns 'deepSequential' when opted in", () => {
		const provider = makeProvider("deepSequential")
		expect(getAgenticMode(provider)).toBe("deepSequential")
	})

	it("returns 'classic' for unknown values", () => {
		const provider = makeProvider("something-else")
		expect(getAgenticMode(provider)).toBe("classic")
	})

	it("returns 'classic' if getValue throws", () => {
		const provider = {
			getValue: vi.fn().mockImplementation(() => {
				throw new Error("not ready")
			}),
		} as unknown as Parameters<typeof getAgenticMode>[0]
		expect(getAgenticMode(provider)).toBe("classic")
	})
})
