/**
 * Zoo Code Performance Optimization - Full Implementation Code
 *
 * This file contains ALL code that needs to be implemented for performance optimization.
 * Each section is labeled with the task number and file path.
 *
 * Tasks:
 * 1. Parallel Extension Activation
 * 2. Background Provider Preloading
 * 3. getState() Optimization
 * 4. State Push Debouncing
 * 5. Migration Parallelization
 * 6. Webview State Optimization
 * 7. Constructor Optimization
 * 8. Message Processing Optimization
 */

// ============================================================================
// TASK 1: src/utils/parallelInit.ts (NEW FILE)
// ============================================================================

/**
 * Parallel execution utility with error handling.
 * Wraps Promise.allSettled to prevent one failure from blocking others.
 */
export async function runParallel<T>(
	tasks: Array<() => Promise<T>>,
	options: { logErrors?: boolean } = {},
): Promise<T[]> {
	const { logErrors = true } = options
	const results = await Promise.allSettled(tasks.map((task) => task()))

	const values: T[] = []
	const errors: Error[] = []

	results.forEach((result, index) => {
		if (result.status === "fulfilled") {
			values.push(result.value)
		} else {
			errors.push(new Error(`Task ${index} failed: ${result.reason}`))
			if (logErrors) {
				console.error(`[ParallelInit] Task ${index} failed:`, result.reason)
			}
		}
	})

	if (errors.length > 0 && logErrors) {
		console.warn(`[ParallelInit] ${errors.length} of ${tasks.length} tasks failed`)
	}

	return values
}

/**
 * Performance instrumentation helper
 */
export class PerformanceTimer {
	private startTime: number
	private label: string

	constructor(label: string) {
		this.label = label
		this.startTime = performance.now()
	}

	end(): number {
		const duration = performance.now() - this.startTime
		console.log(`[${this.label}] ${duration.toFixed(2)}ms`)
		return duration
	}
}

// ============================================================================
// TASK 2: src/api/providerRegistry.ts (NEW FILE)
// ============================================================================

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

// ============================================================================
// TASK 4: src/core/webview/StatePushDebouncer.ts (NEW FILE)
// ============================================================================

/**
 * Debounced state push batching utility.
 * Batches multiple state push requests into a single push.
 */
export class StatePushDebouncer {
	private timer: ReturnType<typeof setTimeout> | null = null
	private pendingResolvers: Array<{ resolve: () => void; reject: (err: any) => void }> = []
	private pushCount = 0
	private debouncedCount = 0

	constructor(
		private readonly provider: { postStateToWebview: () => Promise<void> },
		private readonly delayMs: number = 16, // One frame (60fps)
	) {}

	/**
	 * Schedule a state push. If called multiple times within delayMs,
	 * only one push will occur.
	 */
	schedule(): Promise<void> {
		this.debouncedCount++

		return new Promise((resolve, reject) => {
			this.pendingResolvers.push({ resolve, reject })

			if (this.timer) {
				clearTimeout(this.timer)
			}

			this.timer = setTimeout(() => this.flush(), this.delayMs)
		})
	}

	/**
	 * Immediately flush pending state push.
	 * Use for critical updates that must be visible immediately.
	 */
	async flush(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}

		if (this.pendingResolvers.length === 0) {
			return // Nothing to flush
		}

		const resolvers = this.pendingResolvers.splice(0)

		try {
			await this.provider.postStateToWebview()
			this.pushCount++
			resolvers.forEach((r) => r.resolve())

			// Log stats periodically
			if (this.pushCount % 100 === 0) {
				console.log(`[StatePush] Total: ${this.pushCount}, Debounced saved: ${this.debouncedCount}`)
			}
		} catch (error) {
			resolvers.forEach((r) => r.reject(error))
		}
	}

	/**
	 * Cancel pending state push.
	 * Resolves all pending promises without pushing.
	 */
	cancel(): void {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}

		const resolvers = this.pendingResolvers.splice(0)
		resolvers.forEach((r) => r.resolve()) // Resolve without pushing
	}

	/**
	 * Get statistics
	 */
	getStats(): { pushCount: number; debouncedCount: number; saved: number } {
		return {
			pushCount: this.pushCount,
			debouncedCount: this.debouncedCount,
			saved: this.debouncedCount - this.pushCount,
		}
	}
}

// ============================================================================
// TASK 6: webview-ui/src/utils/shallowEqual.ts (NEW FILE)
// ============================================================================

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

// ============================================================================
// TASK 1: src/extension.ts (MODIFIED - activate function)
// ============================================================================

/**
 * OPTIMIZED activate() function with parallel initialization.
 *
 * Changes:
 * 1. Parallel Batch 1: initializeNetworkProxy, migrateSettings, initializeI18n, TerminalRegistry
 * 2. Parallel Batch 2: ContextProxy, MdmService, initZooCodeAuth
 * 3. Background: checkWorktreeAutoOpen, autoImportSettings, initializeModelCacheRefresh
 * 4. Preload configured provider
 * 5. Performance instrumentation
 */
export async function activate_optimized(context: any) {
	const activationTimer = new PerformanceTimer("zoo-code-activation")

	// Create output channel
	const outputChannel = (globalThis as any).vscode.window.createOutputChannel("Zoo Code")
	context.subscriptions.push(outputChannel)

	outputChannel.appendLine(`Zoo Code extension activated`)

	// ========== BATCH 1: No Dependencies (Parallel) ==========
	await runParallel([
		() => initializeNetworkProxy(context, outputChannel),
		() => migrateSettings(context, outputChannel),
		async () => {
			initializeI18n(context.globalState.get("language") ?? "en")
		},
		async () => {
			TerminalRegistry.initialize()
		},
	])

	// Set extension path for custom tool registry
	customToolRegistry.setExtensionPath(context.extensionPath)

	// Initialize telemetry
	const telemetryService = TelemetryService.createInstance()
	try {
		telemetryService.register(new PostHogTelemetryClient())
	} catch (error) {
		console.warn("Failed to register PostHogTelemetryClient:", error)
	}

	// Create logger for cloud services
	const cloudLogger = createDualLogger(createOutputChannelLogger(outputChannel))

	// ========== BATCH 2: Context-Dependent (Parallel) ==========
	const [contextProxy, mdmService] = await runParallel([
		() => ContextProxy.getInstance(context),
		() => MdmService.createInstance(cloudLogger),
		() => initZooCodeAuth(context),
	])

	// ========== BATCH 3: Provider Construction ==========
	const provider = new ClineProvider(context, outputChannel, "sidebar", contextProxy, mdmService)

	// Initialize CodeIndexManagers in background (already fire-and-forget)
	if ((globalThis as any).vscode.workspace.workspaceFolders) {
		for (const folder of (globalThis as any).vscode.workspace.workspaceFolders) {
			const manager = CodeIndexManager.getInstance(context, folder.uri.fsPath)
			if (manager) {
				void manager.initialize(contextProxy).catch((error: any) => {
					outputChannel.appendLine(`[CodeIndexManager] Error: ${error}`)
				})
				context.subscriptions.push(manager)
			}
		}
	}

	// ========== BACKGROUND OPERATIONS (Non-blocking) ==========

	// Preload configured provider in background
	const configuredProvider = (contextProxy as any).getGlobalState("apiProvider")
	if (configuredProvider) {
		preloadProvider(configuredProvider)
	}

	// Initialize Cloud Service in background
	let cloudService: any
	try {
		cloudService = await CloudService.createInstance(context, cloudLogger, {
			"auth-state-changed": async () => {
				ClineProvider.getVisibleInstance()?.postStateToWebviewWithoutClineMessages()
			},
			"settings-updated": async () => {
				ClineProvider.getVisibleInstance()?.postStateToWebviewWithoutClineMessages()
			},
			"user-info": async () => {
				ClineProvider.getVisibleInstance()?.postStateToWebviewWithoutClineMessages()
			},
		})
		context.subscriptions.push(cloudService)
	} catch (error) {
		outputChannel.appendLine(`[CloudService] Initialization failed: ${error}`)
	}

	// Register provider
	;(globalThis as any).vscode.window.registerWebviewViewProvider(ClineProvider.sideBarId, provider, {
		webviewOptions: { retainContextWhenHidden: true },
	})

	// Deferred operations (after provider registration)
	void checkWorktreeAutoOpen(context, outputChannel).catch((error) => {
		outputChannel.appendLine(`[Worktree] Error: ${error}`)
	})

	void autoImportSettings(outputChannel, {
		providerSettingsManager: provider.providerSettingsManager,
		contextProxy: provider.contextProxy,
		customModesManager: provider.customModesManager,
	}).catch((error) => {
		outputChannel.appendLine(`[AutoImport] Error: ${error}`)
	})

	void initializeModelCacheRefresh()

	// Register commands
	registerCommands({ context, outputChannel, provider })

	// Performance instrumentation
	activationTimer.end()

	return new API(outputChannel, provider, undefined, false)
}

// ============================================================================
// TASK 3: src/core/webview/ClineProvider.ts (MODIFIED - getState method)
// ============================================================================

/**
 * OPTIMIZED getState() method.
 *
 * Changes:
 * 1. Keep existing error handling (already good)
 * 2. Only customModes is truly async
 * 3. Add performance logging
 * 4. Skip caching (risky)
 */
export async function getState_optimized(
	contextProxy: any,
	customModesManager: any,
	taskHistoryStore: any,
): Promise<any> {
	const start = performance.now()

	// Sync reads (no await needed)
	const stateValues = contextProxy.getValues()
	const providerSettings = contextProxy.getProviderSettings()

	// Only truly async call
	const customModes = await customModesManager.getCustomModes()

	// Sync reads with existing error handling
	let organizationAllowList = ORGANIZATION_ALLOW_ALL
	try {
		organizationAllowList = await CloudService.instance.getAllowList()
	} catch (error) {
		console.error(`[getState] failed to get organization allow list: ${error}`)
	}

	let cloudUserInfo: any = null
	try {
		cloudUserInfo = CloudService.instance.getUserInfo()
	} catch (error) {
		console.error(`[getState] failed to get cloud user info: ${error}`)
	}

	let cloudIsAuthenticated = false
	try {
		cloudIsAuthenticated = CloudService.instance.isAuthenticated()
	} catch (error) {
		console.error(`[getState] failed to get cloud authentication state: ${error}`)
	}

	let organizationSettingsVersion = -1
	try {
		if (CloudService.hasInstance()) {
			const settings = CloudService.instance.getOrganizationSettings()
			organizationSettingsVersion = settings?.version ?? -1
		}
	} catch (error) {
		console.error(`[getState] failed to get organization settings version: ${error}`)
	}

	// Build apiProvider with same logic as before
	const apiProvider =
		stateValues.apiProvider && !isRetiredProvider(stateValues.apiProvider) ? stateValues.apiProvider : "anthropic"

	// Ensure apiProvider is set
	if (!providerSettings.apiProvider) {
		providerSettings.apiProvider = apiProvider
	}

	// Performance logging
	const duration = performance.now() - start
	if (duration > 50) {
		console.warn(`[getState] slow execution: ${duration.toFixed(2)}ms`)
	}

	return {
		...stateValues,
		apiConfiguration: providerSettings,
		customModes,
		organizationAllowList,
		cloudUserInfo,
		cloudIsAuthenticated,
		organizationSettingsVersion,
		taskHistory: taskHistoryStore.getAll(),
	}
}

// ============================================================================
// TASK 5: src/core/config/ContextProxy.ts (MODIFIED - initialize method)
// ============================================================================

/**
 * OPTIMIZED initialize() method with parallel migrations.
 *
 * Changes:
 * 1. Load state and secrets in parallel (already done)
 * 2. Run independent migrations in parallel
 * 3. Run dependent migrations sequentially using .then() chains
 * 4. Add performance logging
 */
export async function initialize_optimized(
	stateCache: any,
	secretCache: any,
	originalContext: any,
	logger: any,
	GLOBAL_STATE_KEYS: string[],
	SECRET_STATE_KEYS: string[],
	GLOBAL_SECRET_KEYS: string[],
	migrationFunctions: {
		migrateImageGenerationSettings: () => Promise<void>
		migrateLegacyRooApiProvider: () => Promise<void>
		migrateInvalidApiProvider: () => Promise<void>
		migrateLegacyCondensingPrompt: () => Promise<void>
		migrateOldDefaultCondensingPrompt: () => Promise<void>
	},
): Promise<void> {
	const start = performance.now()

	// Load state in parallel
	const statePromises = GLOBAL_STATE_KEYS.map(async (key) => {
		try {
			stateCache[key] = originalContext.globalState.get(key)
		} catch (error) {
			logger.error(`Error loading global ${key}: ${error}`)
		}
	})

	const secretPromises = [...SECRET_STATE_KEYS, ...GLOBAL_SECRET_KEYS].map(async (key) => {
		try {
			secretCache[key] = await originalContext.secrets.get(key)
		} catch (error) {
			logger.error(`Error loading secret ${key}: ${error}`)
		}
	})

	await Promise.all([...statePromises, ...secretPromises])

	// Run migrations with dependency-aware parallelization
	await Promise.all([
		// Group 1: Independent (can run in parallel with others)
		migrationFunctions.migrateImageGenerationSettings(),

		// Group 2: apiProvider migrations (sequential chain)
		migrationFunctions.migrateLegacyRooApiProvider().then(() => migrationFunctions.migrateInvalidApiProvider()),

		// Group 3: customSupportPrompts migrations (sequential chain)
		migrationFunctions
			.migrateLegacyCondensingPrompt()
			.then(() => migrationFunctions.migrateOldDefaultCondensingPrompt()),
	])

	// Performance logging
	const duration = performance.now() - start
	if (duration > 100) {
		console.warn(`[ContextProxy] Slow initialization: ${duration.toFixed(2)}ms`)
	}
}

// ============================================================================
// TASK 7: src/core/webview/ClineProvider.ts (MODIFIED - constructor)
// ============================================================================

/**
 * OPTIMIZED ClineProvider constructor with phased initialization.
 *
 * Changes:
 * 1. Phase 1: Synchronous (critical)
 * 2. Phase 2: Critical async (must complete before first use)
 * 3. Phase 3: Background (can run anytime)
 * 4. Error handling in promise chain
 * 5. Initialization guards
 */
export class ClineProviderOptimized {
	private _phase2Ready = false
	private _phase2Promise!: Promise<void>
	private statePushDebouncer!: StatePushDebouncer

	// Required for StatePushDebouncer
	postStateToWebview(): Promise<void> {
		// Implementation would go here
		return Promise.resolve()
	}

	constructor(
		private readonly context: any,
		private readonly outputChannel: any,
		private readonly renderContext: "sidebar" | "editor" = "sidebar",
		public readonly contextProxy: any,
		mdmService?: any,
	) {
		const start = performance.now()

		// Phase 1: Synchronous initialization
		this.initPhase1Sync(mdmService)

		// Phase 2: Critical async (don't block constructor)
		this._phase2Promise = this.initPhase2Critical()
			.then(() => {
				// Phase 3: Background initialization
				void this.initPhase3Background()
			})
			.catch((error) => {
				console.error(`[ClineProvider] Phase 2 initialization failed: ${error}`)
			})

		// Performance logging
		const duration = performance.now() - start
		console.log(`[ClineProvider] Constructor: ${duration.toFixed(2)}ms`)
	}

	/**
	 * Phase 1: Synchronous initialization (critical)
	 */
	private initPhase1Sync(mdmService?: any): void {
		// These must be sync
		this.pendingEditOperations = new PendingEditOperationStore(
			ClineProviderOptimized.PENDING_OPERATION_TIMEOUT_MS,
			(message: string) => this.log(message),
		)

		ClineProviderOptimized.activeInstances.add(this)
		this.mdmService = mdmService

		// Initialize debouncer
		this.statePushDebouncer = new StatePushDebouncer(this, 16)
	}

	/**
	 * Phase 2: Critical async initialization
	 * Must complete before first use of customModes or providerSettings
	 */
	private async initPhase2Critical(): Promise<void> {
		await Promise.all([this.initializeProviderSettingsManager(), this.initializeCustomModesManager()])

		this._phase2Ready = true
	}

	/**
	 * Phase 3: Background initialization
	 * Can run anytime, non-blocking
	 */
	private async initPhase3Background(): Promise<void> {
		await Promise.all([this.initializeTaskHistoryStore(), this.initializeMcpHub(), this.initializeSkillsManager()])

		// These depend on nothing
		this._workspaceTracker = new WorkspaceTracker(this)
		this.marketplaceManager = new MarketplaceManager(this.context, this.customModesManager)
	}

	/**
	 * Wait for critical initialization to complete
	 */
	async waitForReady(): Promise<void> {
		if (!this._phase2Ready) {
			await this._phase2Promise
		}
	}

	/**
	 * Get custom modes, waiting for init if needed
	 */
	async getCustomModes(): Promise<any> {
		await this.waitForReady()
		return this.customModesManager.getCustomModes()
	}

	/**
	 * Schedule a debounced state push
	 */
	scheduleStatePush(): Promise<void> {
		return this.statePushDebouncer.schedule()
	}

	/**
	 * Immediately push state (bypass debounce)
	 */
	async immediateStatePush(): Promise<void> {
		await this.statePushDebouncer.flush()
	}

	// Placeholder methods (would be actual implementations)
	private pendingEditOperations: any
	private mdmService: any
	private _workspaceTracker: any
	private marketplaceManager: any
	private customModesManager: any
	private providerSettingsManager: any
	private taskHistoryStore: any
	private mcpHub: any
	private skillsManager: any

	static activeInstances = new Set<ClineProviderOptimized>()
	static PENDING_OPERATION_TIMEOUT_MS = 30000
	static sideBarId = "zoo-code.sidebar"

	private log(message: string): void {
		console.log(message)
	}

	private async initializeProviderSettingsManager(): Promise<void> {
		// Implementation
	}

	private async initializeCustomModesManager(): Promise<void> {
		// Implementation
	}

	private async initializeTaskHistoryStore(): Promise<void> {
		// Implementation
	}

	private async initializeMcpHub(): Promise<void> {
		// Implementation
	}

	private async initializeSkillsManager(): Promise<void> {
		// Implementation
	}

	postStateToWebviewWithoutClineMessages(): void {
		// Implementation
	}

	static getVisibleInstance(): ClineProviderOptimized | undefined {
		return undefined
	}
}

// ============================================================================
// TASK 6: webview-ui/src/context/ExtensionStateContext.tsx (MODIFIED)
// ============================================================================

/**
 * OPTIMIZED mergeExtensionState with shallow comparison.
 *
 * Changes:
 * 1. Check if anything actually changed
 * 2. Return previous state if no changes (prevents re-render)
 * 3. Keep existing merge logic
 */
export function mergeExtensionState_optimized(prevState: any, newState: any): any {
	// Quick check: if newState is empty, return prevState
	if (!newState || Object.keys(newState).length === 0) {
		return prevState
	}

	// Check if anything actually changed
	const hasChanges = Object.keys(newState).some((key) => {
		return prevState[key] !== newState[key]
	})

	// If nothing changed, return previous state (prevents re-render)
	if (!hasChanges) {
		return prevState
	}

	// Existing merge logic
	const { customModePrompts: prevCustomModePrompts, experiments: prevExperiments, ...prevRest } = prevState
	const {
		apiConfiguration,
		customModePrompts: newCustomModePrompts,
		customSupportPrompts,
		experiments: newExperiments,
		...newRest
	} = newState

	const customModePrompts = { ...prevCustomModePrompts, ...(newCustomModePrompts ?? {}) }
	const experiments = { ...prevExperiments, ...(newExperiments ?? {}) }
	const rest = { ...prevRest, ...newRest }

	// Protect clineMessages from stale state pushes
	if (
		newState.clineMessagesSeq !== undefined &&
		prevState.clineMessagesSeq !== undefined &&
		newState.clineMessagesSeq <= prevState.clineMessagesSeq &&
		newState.clineMessages !== undefined
	) {
		rest.clineMessages = prevState.clineMessages
		rest.clineMessagesSeq = prevState.clineMessagesSeq
	}

	return {
		...rest,
		apiConfiguration: apiConfiguration ?? prevState.apiConfiguration,
		customModePrompts,
		customSupportPrompts: customSupportPrompts ?? prevState.customSupportPrompts,
		experiments,
	}
}

// ============================================================================
// TASK 8: webview-ui/src/components/chat/ChatView.tsx (MODIFIED)
// ============================================================================

/**
 * OPTIMIZED ChatView with incremental message processing.
 *
 * Changes:
 * 1. Process only NEW messages (not all)
 * 2. Cache apiMetrics calculation
 * 3. React.memo with custom comparison
 */
export function useOptimizedMessageProcessing(messages: any[]) {
	const [processedMessages, setProcessedMessages] = useState<any[]>([])
	const lastProcessedIndex = useRef(0)
	const apiMetricsCache = useRef<Map<string, any>>(new Map())

	// Incremental processing
	useEffect(() => {
		const newMessages = messages.slice(lastProcessedIndex.current + 1)
		if (newMessages.length === 0) return

		// Process only new messages
		const newProcessed = combineApiRequests(combineCommandSequences(newMessages))

		setProcessedMessages((prev) => [...prev, ...newProcessed])
		lastProcessedIndex.current = messages.length - 1
	}, [messages])

	// Cached apiMetrics
	const apiMetrics = useMemo(() => {
		const hash = processedMessages.length.toString() + (processedMessages[processedMessages.length - 1]?.ts ?? "")

		if (apiMetricsCache.current.has(hash)) {
			return apiMetricsCache.current.get(hash)!
		}

		const metrics = getApiMetrics(processedMessages)
		apiMetricsCache.current.set(hash, metrics)

		// Limit cache size
		if (apiMetricsCache.current.size > 10) {
			const firstKey = apiMetricsCache.current.keys().next().value
			if (firstKey !== undefined) {
				apiMetricsCache.current.delete(firstKey)
			}
		}

		return metrics
	}, [processedMessages])

	return { processedMessages, apiMetrics }
}

// Placeholder imports (would be actual imports in real file)
declare function useState<T>(initial: T): [T, (updater: (prev: T) => T) => void]
declare function useRef<T>(initial: T): { current: T }
declare function useEffect(effect: () => void, deps: any[]): void
declare function useMemo<T>(factory: () => T, deps: any[]): T
declare function combineApiRequests(messages: any[]): any[]
declare function combineCommandSequences(messages: any[]): any[]
declare function getApiMetrics(messages: any[]): any
declare const ORGANIZATION_ALLOW_ALL: any
declare const isRetiredProvider: (provider: string) => boolean
declare function initializeNetworkProxy(context: any, outputChannel: any): Promise<void>
declare function migrateSettings(context: any, outputChannel: any): Promise<void>
declare function initializeI18n(language: string): void
declare const TerminalRegistry: any
declare const customToolRegistry: any
declare const TelemetryService: any
declare const PostHogTelemetryClient: any
declare function createDualLogger(logger: any): any
declare function createOutputChannelLogger(outputChannel: any): any
declare const ContextProxy: any
declare const ClineProvider: any
declare const MdmService: any
declare function initZooCodeAuth(context: any): Promise<void>
declare const CodeIndexManager: any
declare const CloudService: any
declare function registerCommands(options: any): void
declare function checkWorktreeAutoOpen(context: any, outputChannel: any): Promise<void>
declare function autoImportSettings(outputChannel: any, options: any): Promise<void>
declare function initializeModelCacheRefresh(): void
declare class API {
	constructor(outputChannel: any, provider: any, socketPath: any, enableLogging: boolean)
}
declare class PendingEditOperationStore {
	constructor(timeout: number, logger: (message: string) => void)
}
declare class WorkspaceTracker {
	constructor(provider: any)
}
declare class MarketplaceManager {
	constructor(context: any, customModesManager: any)
}
