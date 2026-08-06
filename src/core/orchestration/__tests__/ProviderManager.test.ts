import { describe, it, expect, vi, beforeEach } from "vitest"
import { ProviderManager, classifyProviderFailure } from "../ProviderManager"
import type { ProfileLoader } from "../ProviderManager"

function makeLoader(profiles: Record<string, Record<string, unknown>>): ProfileLoader {
	return {
		getProfile: vi.fn(async ({ name }: { name: string }) => {
			const p = profiles[name]
			if (!p) {
				throw new Error(`Config with name '${name}' not found`)
			}
			return { name, ...p }
		}),
		listConfig: vi.fn(async () => Object.keys(profiles).map((name) => ({ name, id: name, apiProvider: "openai" }))),
	} as unknown as ProfileLoader
}

describe("classifyProviderFailure", () => {
	it("classifies auth, rate limit, transient, non_retryable", () => {
		expect(classifyProviderFailure({ status: 401, message: "nope" })).toBe("auth")
		expect(classifyProviderFailure(new Error("Rate limit exceeded"))).toBe("rate_limit")
		expect(classifyProviderFailure({ status: 503, message: "unavailable" })).toBe("transient")
		expect(classifyProviderFailure(new Error("aborted by user"))).toBe("non_retryable")
		expect(classifyProviderFailure(new Error("something odd"))).toBe("unknown")
	})
})

describe("ProviderManager", () => {
	let loader: ProfileLoader
	let manager: ProviderManager

	beforeEach(() => {
		loader = makeLoader({
			primary: { apiProvider: "openai", openAiApiKey: "k1" },
			backup: { apiProvider: "openai", openAiApiKey: "k2" },
			tertiary: { apiProvider: "openai", openAiApiKey: "k3" },
		})
		manager = new ProviderManager(loader, {
			enabled: true,
			maxParallelWorkers: 4,
			providerFallbackChain: ["backup", "tertiary"],
			workerEnabledProviderNames: [],
			maxSameProviderRetries: 2,
			maxProviderSwitches: 5,
			autoInjectResultsWhenIdle: true,
		})
	})

	it("resolveInitial ignores agent preferred when multiple profiles exist", async () => {
		// Empty worker pool → diversify across all listed profiles (not hard pin primary).
		const a = await manager.resolveInitial({
			preferredApiConfigName: "primary",
			fallbackApiConfigNames: ["backup"],
			currentApiConfigName: "primary",
			loadBalanceUsage: {},
		})
		// first assign: RR among primary/backup/tertiary
		expect(["primary", "backup", "tertiary"]).toContain(a.apiConfigName)
		expect(a.settings).toMatchObject({ apiProvider: "openai" })

		const b = await manager.resolveInitial({
			preferredApiConfigName: "primary",
			currentApiConfigName: "primary",
			loadBalanceUsage: { [a.apiConfigName]: 1 },
		})
		expect(b.apiConfigName).not.toBe(a.apiConfigName)
	})

	it("buildChain de-dupes preferred, per-worker, global, current", () => {
		const chain = manager.buildChain({
			preferred: "primary",
			perWorkerFallback: ["backup", "primary"],
			current: "primary",
		})
		expect(chain).toEqual(["primary", "backup", "tertiary"])
	})

	it("resolveOnFailure retries same provider before switch", async () => {
		const worker = {
			apiConfigName: "primary",
			fallbackChain: ["primary", "backup", "tertiary"],
			fallbackIndex: 0,
			attempt: 0,
		}
		const retry = await manager.resolveOnFailure({
			worker,
			error: new Error("timeout"),
			sameProviderRetryCount: 0,
			providerSwitchCount: 0,
		})
		expect(retry.action).toBe("retry_same")
		expect(retry.backoffMs).toBeGreaterThan(0)

		const switchDec = await manager.resolveOnFailure({
			worker,
			error: new Error("timeout"),
			sameProviderRetryCount: 2,
			providerSwitchCount: 0,
		})
		expect(switchDec.action).toBe("switch")
		expect(switchDec.apiConfigName).toBe("backup")
	})

	it("resolveInitial prefers worker-enabled pool when configured", async () => {
		manager.updateSettings({ workerEnabledProviderNames: ["tertiary"] })
		const r = await manager.resolveInitial({
			currentApiConfigName: "primary",
		})
		expect(r.apiConfigName).toBe("tertiary")
	})

	it("resolveInitial load-balances when preferred omitted", async () => {
		manager.updateSettings({ workerEnabledProviderNames: ["primary", "backup", "tertiary"] })
		const a = await manager.resolveInitial({
			currentApiConfigName: "primary",
			loadBalanceUsage: { primary: 2, backup: 0, tertiary: 1 },
		})
		expect(a.apiConfigName).toBe("backup")

		const b = await manager.resolveInitial({
			currentApiConfigName: "primary",
			loadBalanceUsage: { primary: 1, backup: 1, tertiary: 0 },
		})
		expect(b.apiConfigName).toBe("tertiary")
	})

	it("rate_limit switches immediately when next provider exists", async () => {
		const worker = {
			apiConfigName: "primary",
			fallbackChain: ["primary", "backup", "tertiary"],
			fallbackIndex: 0,
			attempt: 0,
		}
		const dec = await manager.resolveOnFailure({
			worker,
			error: new Error("Rate limit exceeded / quota"),
			sameProviderRetryCount: 0,
			providerSwitchCount: 0,
		})
		expect(dec.action).toBe("switch")
		expect(dec.apiConfigName).toBe("backup")
		expect(dec.failureClass).toBe("rate_limit")
	})

	it("resolveInitial ignores preferred outside the worker-enabled pool", async () => {
		manager.updateSettings({ workerEnabledProviderNames: ["backup", "tertiary"] })
		const r = await manager.resolveInitial({
			preferredApiConfigName: "primary",
			currentApiConfigName: "primary",
		})
		// primary is not in pool — must pick pool entry (preferred first in chain only if in pool)
		expect(r.apiConfigName).toBe("backup")
	})

	it("resolveInitial load-balances even when agent pins the same preferred every time", async () => {
		// Orchestrators often set api_config_name=nvidia for every worker; runtime must still spread.
		manager.updateSettings({ workerEnabledProviderNames: ["primary", "backup", "tertiary"] })
		const a = await manager.resolveInitial({
			preferredApiConfigName: "primary",
			currentApiConfigName: "vertex",
			loadBalanceUsage: {},
		})
		expect(["primary", "backup", "tertiary"]).toContain(a.apiConfigName)

		const b = await manager.resolveInitial({
			preferredApiConfigName: "primary",
			currentApiConfigName: "vertex",
			loadBalanceUsage: { [a.apiConfigName]: 1 },
		})
		expect(b.apiConfigName).not.toBe(a.apiConfigName)

		const c = await manager.resolveInitial({
			preferredApiConfigName: "primary",
			currentApiConfigName: "vertex",
			loadBalanceUsage: { [a.apiConfigName]: 1, [b.apiConfigName]: 1 },
		})
		expect(new Set([a.apiConfigName, b.apiConfigName, c.apiConfigName]).size).toBe(3)

		const d = await manager.resolveInitial({
			preferredApiConfigName: "primary",
			currentApiConfigName: "vertex",
			loadBalanceUsage: { primary: 1, backup: 1, tertiary: 1 },
		})
		// all equal → RR rotates (not stuck on preferred)
		expect(["primary", "backup", "tertiary"]).toContain(d.apiConfigName)
	})

	it("resolveInitial RR spreads four equal-usage pins to four profiles", async () => {
		manager.updateSettings({
			workerEnabledProviderNames: ["nvidia", "vertex", "groq", "mimo"],
		})
		// Re-create loader with those names
		loader = makeLoader({
			nvidia: { apiProvider: "openai", openAiApiKey: "n" },
			vertex: { apiProvider: "openai", openAiApiKey: "v" },
			groq: { apiProvider: "openai", openAiApiKey: "g" },
			mimo: { apiProvider: "openai", openAiApiKey: "m" },
		})
		manager = new ProviderManager(loader, {
			enabled: true,
			maxParallelWorkers: 4,
			providerFallbackChain: [],
			workerEnabledProviderNames: ["nvidia", "vertex", "groq", "mimo"],
			maxSameProviderRetries: 2,
			maxProviderSwitches: 5,
			autoInjectResultsWhenIdle: true,
		})
		const names: string[] = []
		const usage: Record<string, number> = {}
		for (let i = 0; i < 4; i++) {
			const r = await manager.resolveInitial({
				preferredApiConfigName: "nvidia",
				loadBalanceUsage: { ...usage },
			})
			names.push(r.apiConfigName)
			usage[r.apiConfigName] = (usage[r.apiConfigName] ?? 0) + 1
		}
		expect(new Set(names).size).toBe(4)
	})

	it("buildChain includes worker-enabled pool names", () => {
		manager.updateSettings({ workerEnabledProviderNames: ["tertiary", "backup"] })
		const chain = manager.buildChain({ preferred: "primary", current: "primary" })
		expect(chain).toEqual(["primary", "backup", "tertiary"])
	})

	it("fails on non_retryable and exhausted chain", async () => {
		const worker = {
			apiConfigName: "tertiary",
			fallbackChain: ["primary", "backup", "tertiary"],
			fallbackIndex: 2,
			attempt: 3,
		}
		const nonRetry = await manager.resolveOnFailure({
			worker,
			error: new Error("aborted"),
			sameProviderRetryCount: 0,
			providerSwitchCount: 0,
		})
		expect(nonRetry.action).toBe("fail")

		const exhausted = await manager.resolveOnFailure({
			worker,
			error: new Error("timeout"),
			sameProviderRetryCount: 5,
			providerSwitchCount: 0,
		})
		expect(exhausted.action).toBe("fail")
		expect(exhausted.reason).toMatch(/exhausted/i)
	})
})
