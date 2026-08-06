/**
 * F-024: Indirection layer for obtaining the visible ClineProvider.
 *
 * Production code uses a lazy dynamic import to avoid a circular dependency
 * between SpecWorkspacePanel and ClineProvider. Tests can override the
 * accessor via {@link setClineProviderAccessor} to inject a mock without
 * relying on vitest module mocking of dynamic imports.
 */
import type { SelectionContextAction } from "../selection/SelectionContextStore"

export interface VisibleClineProvider {
	prepareSpecSelectionAction(action: SelectionContextAction, token: string): Promise<void>
}

export type ClineProviderResolver = () => VisibleClineProvider | undefined

/**
 * Internal async loader used by the default resolver. Resolves the real
 * ClineProvider module via dynamic import and caches the result.
 *
 * Exported for use by SpecWorkspacePanel; tests do not need to call this.
 */
let cachedProviderModule: typeof import("../../webview/ClineProvider") | undefined

export async function loadClineProviderModule(): Promise<typeof import("../../webview/ClineProvider")> {
	if (!cachedProviderModule) {
		cachedProviderModule = await import("../../webview/ClineProvider")
	}
	return cachedProviderModule
}

/**
 * Default resolver: synchronously returns the cached ClineProvider if the
 * module has already been loaded, otherwise kicks off a background load and
 * returns undefined. Once loaded, subsequent calls resolve synchronously.
 *
 * This mirrors the production behavior where ClineProvider.getVisibleInstance()
 * is a synchronous call — the module is always loaded by the time a selection
 * action fires because the extension has fully activated.
 */
const defaultResolver: ClineProviderResolver = () => {
	if (!cachedProviderModule) {
		// Trigger the async load so the next call is ready.
		void loadClineProviderModule()
		return undefined
	}
	return cachedProviderModule.ClineProvider.getVisibleInstance() ?? undefined
}

let resolver: ClineProviderResolver = defaultResolver

/**
 * Override the ClineProvider resolver. Pass `undefined` (or omit the argument)
 * to restore the default lazy dynamic-import resolver.
 */
export function setClineProviderAccessor(next?: ClineProviderResolver): void {
	resolver = next ?? defaultResolver
}

/**
 * Resolve the visible ClineProvider instance synchronously.
 * Returns `undefined` when no provider is visible (e.g. no chat open).
 */
export function resolveVisibleClineProvider(): VisibleClineProvider | undefined {
	return resolver()
}
