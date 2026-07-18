// npx vitest run src/core/tools/__tests__/providerManageTools.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

import { manageProviderProfileTool } from "../ManageProviderProfileTool"
import { setProviderSecretTool } from "../SetProviderSecretTool"
import { deleteProviderProfileTool } from "../DeleteProviderProfileTool"
import { listProviderProfilesTool } from "../ListProviderProfilesTool"

function makeTask(provider: any) {
	return {
		providerRef: { deref: () => provider },
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		recordToolError: vi.fn(),
		sayAndCreateMissingParamError: vi.fn(async (_t: string, p: string) => `Missing ${p}`),
	} as any
}

function makeCallbacks() {
	const results: string[] = []
	return {
		results,
		callbacks: {
			askApproval: vi.fn(async () => true),
			handleError: vi.fn(async () => {}),
			pushToolResult: vi.fn((r: string) => {
				results.push(typeof r === "string" ? r : JSON.stringify(r))
			}),
		},
	}
}

describe("provider manage tools", () => {
	let provider: any

	beforeEach(() => {
		provider = {
			providerSettingsManager: {
				listConfig: vi.fn(async () => [
					{ name: "default", id: "id-1", apiProvider: "openai" },
					{ name: "secondary", id: "id-2", apiProvider: "anthropic" },
				]),
				hasConfig: vi.fn(async (n: string) => n === "default" || n === "secondary"),
				getProfile: vi.fn(async ({ name }: { name: string }) => ({
					name,
					id: name === "default" ? "id-1" : "id-2",
					apiProvider: "openai",
					openAiModelId: "m1",
					openAiApiKey: "sk-existing",
				})),
				deleteConfig: vi.fn(async () => {}),
				setModeConfig: vi.fn(async () => {}),
			},
			getState: vi.fn(async () => ({ currentApiConfigName: "default", customModes: [] })),
			upsertProviderProfile: vi.fn(async () => "id-new"),
			activateProviderProfile: vi.fn(async () => {}),
		}
	})

	it("list_provider_profiles returns profiles without secrets", async () => {
		const task = makeTask(provider)
		const { callbacks, results } = makeCallbacks()
		await listProviderProfilesTool.execute({}, task, callbacks)
		const body = JSON.parse(results[0])
		expect(body.ok).toBe(true)
		expect(body.profiles).toHaveLength(2)
		expect(body.currentApiConfigName).toBe("default")
		expect(JSON.stringify(body)).not.toContain("sk-")
	})

	it("manage_provider_profile upserts with redacted approval payload and result", async () => {
		const task = makeTask(provider)
		const { callbacks, results } = makeCallbacks()
		await manageProviderProfileTool.execute(
			{
				action: "upsert",
				name: "custom-openai",
				activate: false,
				settings: {
					apiProvider: "openai",
					openAiBaseUrl: "https://x.example/v1",
					openAiModelId: "gpt",
					openAiApiKey: "sk-should-strip",
				},
				secrets: { openAiApiKey: "sk-from-secrets-map" },
			},
			task,
			callbacks,
		)

		expect(callbacks.askApproval).toHaveBeenCalled()
		const approvalJson = (callbacks.askApproval as any).mock.calls[0][1]
		expect(approvalJson).not.toContain("sk-should-strip")
		expect(approvalJson).not.toContain("sk-from-secrets-map")
		expect(approvalJson).toContain("openAiApiKey")

		expect(provider.upsertProviderProfile).toHaveBeenCalled()
		const [, settingsArg, activateArg] = provider.upsertProviderProfile.mock.calls[0]
		expect(settingsArg.openAiApiKey).toBe("sk-from-secrets-map")
		// Save ≠ Switch: third arg must always be false
		expect(activateArg).toBe(false)

		const body = JSON.parse(results[0])
		expect(body.ok).toBe(true)
		expect(body.activated).toBe(false)
		expect(body.currentActiveProfile).toBe("default")
		expect(JSON.stringify(body)).not.toContain("sk-from-secrets-map")
		expect(body.secretKeysStored).toContain("openAiApiKey")
	})

	it("manage_provider_profile ignores activate=true (never switches active profile)", async () => {
		const task = makeTask(provider)
		const { callbacks, results } = makeCallbacks()
		await manageProviderProfileTool.execute(
			{
				action: "upsert",
				name: "half-configured",
				activate: true,
				settings: { apiProvider: "anthropic", apiModelId: "claude" },
				secrets: { apiKey: "sk-anthropic" },
			},
			task,
			callbacks,
		)

		expect(provider.upsertProviderProfile).toHaveBeenCalledWith("half-configured", expect.any(Object), false)
		const body = JSON.parse(results[0])
		expect(body.activated).toBe(false)
		expect(body.note).toMatch(/activate=true was ignored/i)
		expect(body.currentActiveProfile).toBe("default")
		expect(provider.activateProviderProfile).not.toHaveBeenCalled()
	})

	it("set_provider_secret never echoes the value", async () => {
		const task = makeTask(provider)
		const { callbacks, results } = makeCallbacks()
		await setProviderSecretTool.execute(
			{ name: "default", key: "openAiApiKey", value: "sk-brand-new-secret" },
			task,
			callbacks,
		)
		const approvalJson = (callbacks.askApproval as any).mock.calls[0][1]
		expect(approvalJson).not.toContain("sk-brand-new-secret")
		const body = JSON.parse(results[0])
		expect(body.ok).toBe(true)
		expect(body.key).toBe("openAiApiKey")
		expect(body.stored).toBe(true)
		expect(JSON.stringify(body)).not.toContain("sk-brand-new-secret")
		expect(provider.upsertProviderProfile).toHaveBeenCalled()
	})

	it("delete_provider_profile refuses last profile", async () => {
		provider.providerSettingsManager.listConfig = vi.fn(async () => [
			{ name: "only", id: "id-1", apiProvider: "openai" },
		])
		const task = makeTask(provider)
		const { callbacks, results } = makeCallbacks()
		await deleteProviderProfileTool.execute({ name: "only" }, task, callbacks)
		expect(provider.providerSettingsManager.deleteConfig).not.toHaveBeenCalled()
		expect(results[0]).toMatch(/last remaining/i)
	})

	it("delete_provider_profile deletes and activates fallback", async () => {
		const task = makeTask(provider)
		const { callbacks, results } = makeCallbacks()
		await deleteProviderProfileTool.execute({ name: "default" }, task, callbacks)
		expect(provider.providerSettingsManager.deleteConfig).toHaveBeenCalledWith("default")
		expect(provider.activateProviderProfile).toHaveBeenCalledWith({ name: "secondary" })
		const body = JSON.parse(results[0])
		expect(body.ok).toBe(true)
		expect(body.deleted).toBe("default")
	})
})
