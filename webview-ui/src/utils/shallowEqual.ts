/**
 * Shallow comparison helper for React.memo optimization.
 * Compares two objects by reference equality of their values.
 */
export function shallowEqual(obj1: any, obj2: any): boolean {
	if (obj1 === obj2) {
		return true
	}

	if (typeof obj1 !== "object" || typeof obj2 !== "object") {
		return false
	}

	if (obj1 === null || obj2 === null) {
		return false
	}

	const keys1 = Object.keys(obj1)
	const keys2 = Object.keys(obj2)

	if (keys1.length !== keys2.length) {
		return false
	}

	for (const key of keys1) {
		if (obj1[key] !== obj2[key]) {
			return false
		}
	}

	return true
}

/**
 * Check if state has actually changed (for mergeExtensionState optimization)
 */
export function hasStateChanged(prevState: any, newState: any): boolean {
	const keys = Object.keys(newState)

	for (const key of keys) {
		if (prevState[key] !== newState[key]) {
			return true
		}
	}

	return false
}
