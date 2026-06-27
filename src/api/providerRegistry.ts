/**
 * Provider preloading registry.
 * Preloads providers in background without blocking sync API.
 */

// Preloaded providers cache
const preloadedProviders = new Map<string, any>()

// Provider path mapping (provider name -> file path)
const providerPathMap: Record<string, string> = {
	anthropic: "anthropic",
	openrouter: "openrouter",
	bedrock: "bedrock",
	vertex: "vertex",
	openai: "openai",
	ollama: "native-ollama",
	lmstudio: "lm-studio",
	gemini: "gemini",
	"openai-codex": "openai-codex",
	"openai-native": "openai-native",
	deepseek: "deepseek",
	"qwen-code": "qwen-code",
	moonshot: "moonshot",
	"vscode-lm": "vscode-lm",
	mistral: "mistral",
	requesty: "requesty",
	unbound: "unbound",
	"fake-ai": "fake-ai",
	xai: "xai",
	litellm: "lite-llm",
	sambanova: "sambanova",
	mimo: "mimo",
	zai: "zai",
	fireworks: "fireworks",
	"vercel-ai-gateway": "vercel-ai-gateway",
	"opencode-go": "opencode-go",
	"zoo-gateway": "zoo-gateway",
	minimax: "minimax",
	baseten: "baseten",
	poe: "poe",
}

/**
 * Get the file path for a provider
 */
function getProviderPath(providerName: string): string {
	return providerPathMap[providerName] ?? providerName
}

/**
 * Preload a provider in background (non-blocking).
 * Call this early in extension activation.
 */
export function preloadProvider(providerName: string): void {
	if (preloadedProviders.has(providerName)) {
		return // Already preloaded
	}

	const providerPath = getProviderPath(providerName)

	// Dynamic import in background
	import(`./providers/${providerPath}`)
		.then((module) => {
			// Store the handler class
			const HandlerClass = module.default ?? Object.values(module)[0]
			preloadedProviders.set(providerName, HandlerClass)
			console.log(`[ProviderRegistry] Preloaded: ${providerName}`)
		})
		.catch((error) => {
			console.warn(`[ProviderRegistry] Failed to preload ${providerName}:`, error)
		})
}

/**
 * Get preloaded provider handler class (sync).
 * Returns null if not preloaded yet.
 */
export function getPreloadedProvider(providerName: string): any | null {
	return preloadedProviders.get(providerName) ?? null
}

/**
 * Check if a provider is preloaded
 */
export function isProviderPreloaded(providerName: string): boolean {
	return preloadedProviders.has(providerName)
}

/**
 * Clear preloaded providers cache (for development hot reload)
 */
export function clearPreloadedProviders(): void {
	preloadedProviders.clear()
}
