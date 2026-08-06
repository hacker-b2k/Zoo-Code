import type { ClineMessage, ModelInfo, ProviderSettings, ResolvedModelCapabilities, TokenUsage } from "@roo-code/types"

import type { ApiHandler } from "../../api"
import { getModelMaxOutputTokens } from "../../shared/api"
import { getApiMetrics } from "../../shared/getApiMetrics"
import {
	manageContext,
	willManageContext,
	type ContextManagementOptions,
	type ContextManagementResult,
} from "../context-management"
import type { ApiMessage } from "../task-persistence"
import { ModelCapabilityResolver, type ModelCapabilityResolverOptions } from "./ModelCapabilityResolver"

export interface RuntimeContextState {
	modelId: string
	modelInfo: ModelInfo
	resolvedCapabilities: ResolvedModelCapabilities
	maxTokens?: number
	contextWindow: number
	useAvailableInputForContextPercent: boolean
}

export interface EvaluateContextManagementOptions {
	messages: ApiMessage[]
	totalTokens: number
	apiHandler: ApiHandler
	settings: ProviderSettings
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	profileThresholds: Record<string, number>
	currentProfileId: string
}

export interface RuntimeContextEvaluationResult {
	runtime: RuntimeContextState
	lastMessageTokens: number
	shouldManageContext: boolean
}

export interface ManageRuntimeContextOptions extends Omit<
	ContextManagementOptions,
	"contextWindow" | "maxTokens" | "useAvailableInputForContextPercent"
> {
	apiHandler: ApiHandler
	settings: ProviderSettings
	runtime?: RuntimeContextState
}

export class RuntimeContextManager {
	private readonly resolver: ModelCapabilityResolver

	constructor(options: ModelCapabilityResolverOptions = {}) {
		this.resolver = new ModelCapabilityResolver(options)
	}

	getTokenUsage(messages: ClineMessage[], combineMessages: (messages: ClineMessage[]) => ClineMessage[]): TokenUsage {
		return getApiMetrics(combineMessages(messages))
	}

	resolveRuntimeContext({
		apiHandler,
		settings,
	}: {
		apiHandler: ApiHandler
		settings: ProviderSettings
	}): RuntimeContextState {
		const { id: modelId, info: modelInfo } = apiHandler.getModel()
		const resolvedCapabilities = this.resolver.resolve({
			settings,
			model: modelInfo,
			modelId,
			condenseContextWindow: apiHandler.getCondenseContextWindow?.(),
		})

		return {
			modelId,
			modelInfo: resolvedCapabilities.modelInfo,
			resolvedCapabilities,
			maxTokens: getModelMaxOutputTokens({
				modelId,
				model: resolvedCapabilities.modelInfo,
				settings,
			}),
			contextWindow: resolvedCapabilities.condenseContextWindow,
			useAvailableInputForContextPercent: typeof apiHandler.getCondenseContextWindow === "function",
		}
	}

	async evaluateContextManagement({
		messages,
		totalTokens,
		apiHandler,
		settings,
		autoCondenseContext,
		autoCondenseContextPercent,
		profileThresholds,
		currentProfileId,
	}: EvaluateContextManagementOptions): Promise<RuntimeContextEvaluationResult> {
		const runtime = this.resolveRuntimeContext({ apiHandler, settings })
		const lastMessageTokens = await this.estimateLastMessageTokens(messages, apiHandler)

		return {
			runtime,
			lastMessageTokens,
			shouldManageContext: willManageContext({
				totalTokens,
				contextWindow: runtime.contextWindow,
				maxTokens: runtime.maxTokens,
				autoCondenseContext,
				autoCondenseContextPercent,
				profileThresholds,
				currentProfileId,
				lastMessageTokens,
				useAvailableInputForContextPercent: runtime.useAvailableInputForContextPercent,
			}),
		}
	}

	async manageConversationContext({
		apiHandler,
		settings,
		runtime,
		...options
	}: ManageRuntimeContextOptions): Promise<ContextManagementResult> {
		const resolvedRuntime = runtime ?? this.resolveRuntimeContext({ apiHandler, settings })

		return manageContext({
			...options,
			apiHandler,
			contextWindow: resolvedRuntime.contextWindow,
			maxTokens: resolvedRuntime.maxTokens,
			useAvailableInputForContextPercent: resolvedRuntime.useAvailableInputForContextPercent,
		})
	}

	private async estimateLastMessageTokens(messages: ApiMessage[], apiHandler: ApiHandler): Promise<number> {
		const lastMessage = messages[messages.length - 1]
		const lastMessageContent = lastMessage?.content

		if (!lastMessageContent) {
			return 0
		}

		return Array.isArray(lastMessageContent)
			? await apiHandler.countTokens(lastMessageContent)
			: await apiHandler.countTokens([{ type: "text", text: lastMessageContent as string }])
	}
}
