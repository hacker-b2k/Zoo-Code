import React from "react"
import { act, renderHook } from "@testing-library/react"
import type { VirtuosoHandle } from "react-virtuoso"

import { useScrollLifecycle, type UseScrollLifecycleOptions } from "../useScrollLifecycle"

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface ScrollCall {
	index: "LAST" | number
	align?: string
	behavior?: string
}

/**
 * Builds a fake Virtuoso handle that records every scrollToIndex call so tests
 * can assert whether the hook re-pinned to the bottom.
 */
const createVirtuosoRef = (calls: ScrollCall[]): React.RefObject<VirtuosoHandle | null> => {
	const handle = {
		scrollToIndex: (options: ScrollCall) => {
			calls.push(options)
		},
	} as unknown as VirtuosoHandle
	return { current: handle }
}

const createScrollContainerRef = (): React.RefObject<HTMLDivElement | null> => {
	const el = document.createElement("div")
	document.body.appendChild(el)
	return { current: el }
}

interface RenderOptions {
	isStreaming?: boolean
	taskTs?: number | undefined
	isHidden?: boolean
	hasTask?: boolean
}

const renderScrollLifecycle = (calls: ScrollCall[], overrides: RenderOptions = {}) => {
	const virtuosoRef = createVirtuosoRef(calls)
	const scrollContainerRef = createScrollContainerRef()

	const initialProps: UseScrollLifecycleOptions = {
		virtuosoRef,
		scrollContainerRef,
		taskTs: overrides.taskTs ?? 1000,
		isStreaming: overrides.isStreaming ?? false,
		isHidden: overrides.isHidden ?? false,
		hasTask: overrides.hasTask ?? true,
	}

	const utils = renderHook((props: UseScrollLifecycleOptions) => useScrollLifecycle(props), {
		initialProps,
	})

	return { ...utils, virtuosoRef, scrollContainerRef }
}

/**
 * Drives the hook into the ANCHORED_FOLLOWING phase the way Virtuoso would in
 * production: the hydration window issues an initial pin, and once the list
 * reports it is genuinely at the bottom we enter anchored following.
 */
const enterAnchoredFollowing = (result: { current: ReturnType<typeof useScrollLifecycle> }) => {
	act(() => {
		result.current.atBottomStateChangeCallback(true)
		vi.advanceTimersByTime(700)
	})
	expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
}

const countBottomPins = (calls: ScrollCall[]): number =>
	calls.filter((call) => call.index === "LAST" && call.align === "end").length

describe("useScrollLifecycle tool/file-read follow regression", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.clearAllTimers()
		vi.useRealTimers()
		document.body.innerHTML = ""
	})

	// Scenario 1: While the agent is reading files / running tools, a Task
	// Activity Group finishing and collapsing shrinks a row. Virtuoso reports a
	// transient atBottomStateChange(false) even though the user never scrolled
	// away. The view must re-pin to the latest activity.
	it("re-pins to bottom when a group collapse reports transient not-at-bottom while not streaming", () => {
		const calls: ScrollCall[] = []
		const { result } = renderScrollLifecycle(calls, { isStreaming: false })

		enterAnchoredFollowing(result)
		const baseline = calls.length

		// Group collapse / tool-activity removal means transient not-at-bottom.
		act(() => {
			result.current.atBottomStateChangeCallback(false)
		})

		// Must have issued a re-pin to LAST while remaining in follow mode.
		expect(calls.length).toBeGreaterThan(baseline)
		expect(calls[calls.length - 1]).toMatchObject({ index: "LAST", align: "end" })
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		expect(result.current.showScrollToBottom).toBe(false)
	})

	it("re-pins on a shrinking row height change even when the bottom flag is transiently false", () => {
		const calls: ScrollCall[] = []
		const { result } = renderScrollLifecycle(calls, { isStreaming: false })

		enterAnchoredFollowing(result)
		const baselinePins = countBottomPins(calls)

		// Simulate the group-collapse render cycle: bottom flag flips false,
		// then the collapsed row reports a height change (shrink).
		act(() => {
			result.current.isAtBottomRef.current = false
			result.current.handleRowHeightChange(false)
		})

		expect(countBottomPins(calls)).toBeGreaterThan(baselinePins)
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
	})

	// Scenario 2: The final "task completed" message renders after streaming
	// has stopped (isStreaming=false). The view must stay pinned to the latest
	// response rather than jumping back to older messages.
	it("keeps the view pinned to the latest message when the completion row renders after streaming stops", () => {
		const calls: ScrollCall[] = []
		const { result, rerender, virtuosoRef, scrollContainerRef } = renderScrollLifecycle(calls, {
			isStreaming: true,
		})

		enterAnchoredFollowing(result)

		// Streaming ends; the completion result message is appended.
		act(() => {
			rerender({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1000,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			})
		})

		const baseline = calls.length

		// Completion row grows the last row after the stream ends.
		act(() => {
			result.current.handleRowHeightChange(true)
		})

		expect(calls.length).toBeGreaterThan(baseline)
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
	})

	// Scenario 3: Once the user manually scrolls up, auto-follow is disabled and
	// must NOT be re-enabled by subsequent transient not-at-bottom signals or
	// height changes. It resumes only when the user returns to the bottom.
	it("does not re-pin after the user manually scrolls up, and resumes only at the bottom", () => {
		const calls: ScrollCall[] = []
		const { result } = renderScrollLifecycle(calls, { isStreaming: false })

		enterAnchoredFollowing(result)

		// User manually scrolls up (wheel / pointer / keyboard up-intent).
		act(() => {
			result.current.enterUserBrowsingHistory("wheel-up")
		})
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")
		expect(result.current.showScrollToBottom).toBe(true)
		expect(result.current.followOutputCallback()).toBe(false)

		const baseline = calls.length

		// Agent keeps producing activity: transient not-at-bottom + height
		// changes. None of these may force a scroll back to the bottom.
		act(() => {
			result.current.atBottomStateChangeCallback(false)
			result.current.handleRowHeightChange(true)
			result.current.handleRowHeightChange(false)
		})

		expect(calls.length).toBe(baseline)
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")
		expect(result.current.followOutputCallback()).toBe(false)

		// User returns to the bottom; follow resumes.
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		expect(result.current.followOutputCallback()).toBe("auto")
	})

	// While streaming, followOutput="auto" already handles new-item scrolls, so
	// the atBottomStateChange(false) path must NOT issue a competing pin (which
	// previously caused visible jitter).
	it("does not issue a competing scroll on transient not-at-bottom while streaming", () => {
		const calls: ScrollCall[] = []
		const { result } = renderScrollLifecycle(calls, { isStreaming: true })

		enterAnchoredFollowing(result)
		const baseline = calls.length

		act(() => {
			result.current.atBottomStateChangeCallback(false)
		})

		expect(calls.length).toBe(baseline)
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		expect(result.current.showScrollToBottom).toBe(false)
	})
})
