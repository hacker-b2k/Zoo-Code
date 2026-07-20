import type {
	ApiProtocol,
	ContextWindowState,
	ContextWindowValueSource,
	ModelCapabilityResolutionWarning,
	ModelInfo,
	ProviderName,
	ProviderSettings,
} from "@roo-code/types"

export interface ModelCapabilityResolutionRequest {
	provider?: ProviderName
	settings: ProviderSettings
	modelId: string
	model: ModelInfo
	protocol: ApiProtocol
	condenseContextWindow?: number
}

export interface ProviderCapabilityResolutionResult {
	contextWindow?: number
	contextWindowState?: ContextWindowState
	contextWindowValue?: number
	contextWindowSource?: ContextWindowValueSource
	condenseContextWindow?: number
	condenseContextWindowState?: ContextWindowState
	condenseContextWindowValue?: number
	condenseContextWindowSource?: ContextWindowValueSource
	modelOverrides?: Partial<ModelInfo>
	warnings?: ModelCapabilityResolutionWarning[]
}

export interface ProviderAdapter {
	readonly id: string
	readonly priority?: number
	canResolve(request: ModelCapabilityResolutionRequest): boolean
	resolve(request: ModelCapabilityResolutionRequest): ProviderCapabilityResolutionResult | undefined
}

export const DEFAULT_PROVIDER_ADAPTER_PRIORITY = 0
