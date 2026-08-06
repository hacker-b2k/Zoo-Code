import type { ProviderSettings } from "@roo-code/types"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import {
	applyBestProviderDefaults,
	getClineProvider,
	isValidApiProvider,
	redactProviderSettings,
	stripSecretsFromSettings,
} from "./helpers/providerProfileTools"

interface ManageProviderProfileParams {
	action: "create" | "update" | "upsert"
	name: string
	/** @deprecated Ignored. Save never activates; use activate_provider_profile to switch. */
	activate?: boolean | null
	settings: Record<string, unknown>
	secrets?: Record<string, string>
}

export class ManageProviderProfileTool extends BaseTool<"manage_provider_profile"> {
	readonly name = "manage_provider_profile" as const

	async execute(params: ManageProviderProfileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const action = params.action
		const name = params.name?.trim()
		const settingsIn = params.settings ?? {}
		const secretsIn = params.secrets ?? {}
		// Save ≠ Switch: manage never activates. UI dropdown still activates on manual select.
		const activateRequested = params.activate === true

		try {
			if (!action || !["create", "update", "upsert"].includes(action)) {
				task.consecutiveMistakeCount++
				task.recordToolError("manage_provider_profile")
				pushToolResult(
					formatResponse.toolError(`Invalid action. Use create | update | upsert. Got: ${String(action)}`),
				)
				return
			}

			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("manage_provider_profile")
				pushToolResult(await task.sayAndCreateMissingParamError("manage_provider_profile", "name"))
				return
			}

			if (!settingsIn || typeof settingsIn !== "object" || Array.isArray(settingsIn)) {
				task.consecutiveMistakeCount++
				task.recordToolError("manage_provider_profile")
				pushToolResult(formatResponse.toolError("settings must be an object of non-secret provider fields"))
				return
			}

			const provider = getClineProvider(task)
			const exists = await provider.providerSettingsManager.hasConfig(name)

			if (action === "create" && exists) {
				task.recordToolError("manage_provider_profile")
				pushToolResult(formatResponse.toolError(`Profile "${name}" already exists. Use update or upsert.`))
				return
			}

			if (action === "update" && !exists) {
				task.recordToolError("manage_provider_profile")
				pushToolResult(formatResponse.toolError(`Profile "${name}" does not exist. Use create or upsert.`))
				return
			}

			// Split any secrets wrongly placed in settings
			const { nonSecret, secrets: nestedSecrets } = stripSecretsFromSettings(
				settingsIn as Record<string, unknown>,
			)
			const secrets: Record<string, string> = { ...nestedSecrets }
			if (secretsIn && typeof secretsIn === "object") {
				for (const [k, v] of Object.entries(secretsIn)) {
					if (typeof v === "string") {
						secrets[k] = v
					}
				}
			}

			const apiProvider = nonSecret.apiProvider
			if (apiProvider !== undefined && !isValidApiProvider(apiProvider)) {
				task.consecutiveMistakeCount++
				task.recordToolError("manage_provider_profile")
				pushToolResult(
					formatResponse.toolError(
						`Unknown apiProvider "${String(apiProvider)}". Use custom-endpoint (unknown protocol), openai, anthropic, or openrouter. Retry manage_provider_profile once — do not explore the repo.`,
					),
				)
				return
			}

			// Merge with existing profile for update/upsert
			let base: Record<string, unknown> = {}
			if (exists) {
				const existing = await provider.providerSettingsManager.getProfile({ name })
				const { name: _n, ...rest } = existing
				base = { ...rest }
			}

			// Best defaults only fill gaps left by the agent/user — never overwrite explicit values
			const secretKeysPresent = Object.keys(secrets)
			const { settings: withDefaults, appliedDefaults } = applyBestProviderDefaults(nonSecret, {
				hadIncomingSecrets: secretKeysPresent.length > 0,
			})
			const merged: Record<string, unknown> = { ...base, ...withDefaults, ...secrets }

			// After secrets merge: if tool remapped to custom-endpoint, copy openAiApiKey habit into customEndpointApiKey
			if (
				merged.apiProvider === "custom-endpoint" &&
				(merged.customEndpointApiKey === undefined || merged.customEndpointApiKey === "") &&
				typeof merged.openAiApiKey === "string" &&
				merged.openAiApiKey.length > 0
			) {
				merged.customEndpointApiKey = merged.openAiApiKey
				if (!appliedDefaults.includes("customEndpointApiKey(from openAiApiKey)")) {
					appliedDefaults.push("customEndpointApiKey(from openAiApiKey)")
				}
				// Reflect correct secret key name in tool result / approval metadata
				if (!secretKeysPresent.includes("customEndpointApiKey")) {
					secretKeysPresent.push("customEndpointApiKey")
				}
			}

			// Save only — never activate (avoids interrupting running agents on partial setup).
			// Explicit switch: activate_provider_profile. Settings UI dropdown still activates on select.
			const stateBefore = await provider.getState()
			const currentActiveBefore = stateBefore.currentApiConfigName

			const approvalPayload = {
				tool: "manageProviderProfile",
				action,
				name,
				activate: false,
				settings: redactProviderSettings(withDefaults),
				secretKeys: secretKeysPresent,
				appliedDefaults,
				// never include secret values in approval UI metadata
			}

			const didApprove = await askApproval("tool", JSON.stringify(approvalPayload))
			if (!didApprove) {
				return
			}

			const id = await provider.upsertProviderProfile(name, merged as ProviderSettings, false)

			if (!id) {
				task.recordToolError("manage_provider_profile")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(`Failed to ${action} profile "${name}"`))
				return
			}

			const stateAfter = await provider.getState()
			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						action,
						name,
						id,
						activated: false,
						currentActiveProfile: stateAfter.currentApiConfigName ?? currentActiveBefore,
						secretKeysStored: secretKeysPresent,
						appliedDefaults,
						settings: redactProviderSettings({ ...withDefaults, apiProvider: merged.apiProvider }),
						note:
							"Saved profile only (active provider unchanged). To switch, call activate_provider_profile. Secrets never echoed." +
							(activateRequested
								? " activate=true was ignored — use activate_provider_profile for switching."
								: ""),
					},
					null,
					2,
				),
			)
		} catch (error) {
			task.recordToolError("manage_provider_profile")
			await handleError("managing provider profile", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"manage_provider_profile">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "manageProviderProfile",
			action: block.params.action ?? "",
			name: block.params.name ?? "",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const manageProviderProfileTool = new ManageProviderProfileTool()
