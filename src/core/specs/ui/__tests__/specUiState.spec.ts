import { describe, it, expect, beforeEach } from "vitest"

import {
	clearLastOpened,
	lastOpenedStateKey,
	loadLastOpened,
	saveLastOpened,
	SPEC_UI_STATE_KEY_PREFIX,
	type SpecUiLastOpened,
} from "../specUiState"

function createMemoryMemento() {
	const store = new Map<string, unknown>()
	return {
		get<T>(key: string, defaultValue?: T): T | undefined {
			if (store.has(key)) {
				return store.get(key) as T
			}
			return defaultValue
		},
		update(key: string, value: unknown): Thenable<void> {
			if (value === undefined) {
				store.delete(key)
			} else {
				store.set(key, value)
			}
			return Promise.resolve()
		},
		keys: () => [...store.keys()],
		_store: store,
	}
}

describe("specUiState last-opened persistence", () => {
	let memento: ReturnType<typeof createMemoryMemento>
	const hash = "abc123def4567890"

	beforeEach(() => {
		memento = createMemoryMemento()
	})

	it("uses a stable key prefix per workspace hash", () => {
		expect(lastOpenedStateKey(hash)).toBe(`${SPEC_UI_STATE_KEY_PREFIX}${hash}`)
	})

	it("saves and loads last opened selection (restart restore)", async () => {
		const state: SpecUiLastOpened = {
			specId: "spec-1",
			docKind: "design",
			workspaceRoot: "/tmp/project",
			updatedAt: 123,
		}
		await saveLastOpened(memento as any, hash, state)
		expect(loadLastOpened(memento as any, hash)).toEqual(state)
	})

	it("isolates last-opened state by workspace hash", async () => {
		await saveLastOpened(memento as any, "hash-a", {
			specId: "a",
			docKind: "requirements",
			workspaceRoot: "/a",
			updatedAt: 1,
		})
		await saveLastOpened(memento as any, "hash-b", {
			specId: "b",
			docKind: "tasks",
			workspaceRoot: "/b",
			updatedAt: 2,
		})
		expect(loadLastOpened(memento as any, "hash-a")?.specId).toBe("a")
		expect(loadLastOpened(memento as any, "hash-b")?.docKind).toBe("tasks")
	})

	it("clears last opened", async () => {
		await saveLastOpened(memento as any, hash, {
			specId: "x",
			docKind: "requirements",
			workspaceRoot: "/x",
			updatedAt: 1,
		})
		await clearLastOpened(memento as any, hash)
		expect(loadLastOpened(memento as any, hash)).toBeUndefined()
	})
})
