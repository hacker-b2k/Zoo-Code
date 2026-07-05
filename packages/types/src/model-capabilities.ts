import { z } from "zod"

import { modelInfoSchema } from "./model.js"
import { providerNamesSchema } from "./provider-settings.js"

export const apiProtocols = ["anthropic", "openai"] as const

export const apiProtocolSchema = z.enum(apiProtocols)

export type ApiProtocol = z.infer<typeof apiProtocolSchema>

export const endpointProfileProtocols = [...apiProtocols, "unknown"] as const

export const endpointProfileProtocolSchema = z.enum(endpointProfileProtocols)

export type EndpointProfileProtocol = z.infer<typeof endpointProfileProtocolSchema>

export const endpointProfileSources = ["provider", "manual", "discovery", "probe"] as const

export const endpointProfileSourceSchema = z.enum(endpointProfileSources)

export type EndpointProfileSource = z.infer<typeof endpointProfileSourceSchema>

export const endpointProfileSchema = z.object({
	id: z.string().optional(),
	provider: providerNamesSchema.optional(),
	baseUrl: z.string().optional(),
	protocol: endpointProfileProtocolSchema,
	source: endpointProfileSourceSchema,
	supportsModelDiscovery: z.boolean().optional(),
	supportsStreaming: z.boolean().optional(),
	isOpenAiCompatible: z.boolean().optional(),
	isAnthropicCompatible: z.boolean().optional(),
	labels: z.array(z.string()).optional(),
})

export type EndpointProfile = z.infer<typeof endpointProfileSchema>

export const contextWindowStates = ["unknown", "safe_fallback", "detected", "confirmed"] as const

export const contextWindowStateSchema = z.enum(contextWindowStates)

export type ContextWindowState = z.infer<typeof contextWindowStateSchema>

export const contextWindowValueSources = [
	"model_info",
	"provider_adapter",
	"provider_setting",
	"handler_override",
	"safe_fallback",
] as const

export const contextWindowValueSourceSchema = z.enum(contextWindowValueSources)

export type ContextWindowValueSource = z.infer<typeof contextWindowValueSourceSchema>

export const modelCapabilityResolutionWarnings = [
	"invalid_model_context_window",
	"invalid_condense_context_window",
	"condense_window_exceeds_context_window",
	"adapter_returned_invalid_context_window",
	"adapter_returned_invalid_condense_context_window",
] as const

export const modelCapabilityResolutionWarningSchema = z.enum(modelCapabilityResolutionWarnings)

export type ModelCapabilityResolutionWarning = z.infer<typeof modelCapabilityResolutionWarningSchema>

export const resolvedModelCapabilitiesSchema = z.object({
	provider: providerNamesSchema.optional(),
	modelId: z.string(),
	protocol: apiProtocolSchema,
	endpointProfile: endpointProfileSchema.optional(),
	modelInfo: modelInfoSchema,
	contextWindow: z.number().int().positive(),
	contextWindowState: contextWindowStateSchema.optional(),
	contextWindowValue: z.number().int().positive().optional(),
	contextWindowSource: contextWindowValueSourceSchema,
	condenseContextWindow: z.number().int().positive(),
	condenseContextWindowState: contextWindowStateSchema.optional(),
	condenseContextWindowValue: z.number().int().positive().optional(),
	condenseContextWindowSource: contextWindowValueSourceSchema,
	warnings: z.array(modelCapabilityResolutionWarningSchema),
})

export type ResolvedModelCapabilities = z.infer<typeof resolvedModelCapabilitiesSchema>
