import {
	DEFAULT_PROVIDER_ADAPTER_PRIORITY,
	type ModelCapabilityResolutionRequest,
	type ProviderAdapter,
	type ProviderCapabilityResolutionResult,
} from "./provider-adapter.js"

export interface RegistryResolutionResult {
	adapter: ProviderAdapter
	result: ProviderCapabilityResolutionResult
}

export class ContextWindowRegistry {
	private readonly adapters = new Map<string, ProviderAdapter>()

	register(adapter: ProviderAdapter): void {
		this.adapters.set(adapter.id, adapter)
	}

	registerMany(adapters: ProviderAdapter[]): void {
		for (const adapter of adapters) {
			this.register(adapter)
		}
	}

	unregister(id: string): boolean {
		return this.adapters.delete(id)
	}

	has(id: string): boolean {
		return this.adapters.has(id)
	}

	clear(): void {
		this.adapters.clear()
	}

	get(id: string): ProviderAdapter | undefined {
		return this.adapters.get(id)
	}

	list(): ProviderAdapter[] {
		return [...this.adapters.values()].sort(sortProviderAdapters)
	}

	resolve(request: ModelCapabilityResolutionRequest): RegistryResolutionResult | undefined {
		for (const adapter of this.list()) {
			if (!adapter.canResolve(request)) {
				continue
			}

			const result = adapter.resolve(request)
			if (result) {
				return { adapter, result }
			}
		}

		return undefined
	}
}

function sortProviderAdapters(a: ProviderAdapter, b: ProviderAdapter): number {
	const priorityDelta =
		(b.priority ?? DEFAULT_PROVIDER_ADAPTER_PRIORITY) - (a.priority ?? DEFAULT_PROVIDER_ADAPTER_PRIORITY)
	if (priorityDelta !== 0) {
		return priorityDelta
	}

	return a.id.localeCompare(b.id)
}
