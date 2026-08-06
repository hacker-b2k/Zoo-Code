/**
 * Auto-import one-shot behavior.
 *
 * After vi.resetModules() we re-import both ./fs and the importExport module,
 * then spy on their exports so the module under test binds to the spies.
 * (vi.mock alone was not intercepting exports in this package layout.)
 */

const { mockGetConfiguration, mockShowInformationMessage, mockShowWarningMessage } = vi.hoisted(() => ({
	mockGetConfiguration: vi.fn(),
	mockShowInformationMessage: vi.fn(),
	mockShowWarningMessage: vi.fn(),
}))

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: mockGetConfiguration,
	},
	window: {
		showInformationMessage: mockShowInformationMessage,
		showWarningMessage: mockShowWarningMessage,
	},
}))

vi.mock("path", async (importOriginal) => {
	const actual = await importOriginal<typeof import("path")>()
	return {
		...actual,
		default: {
			...actual,
			join: (...args: string[]) => args.join("/"),
			isAbsolute: (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p),
			basename: (p: string) => p.split(/[\\/]/).pop() || "",
		},
		join: (...args: string[]) => args.join("/"),
		isAbsolute: (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p),
		basename: (p: string) => p.split(/[\\/]/).pop() || "",
	}
})

vi.mock("os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("os")>()
	return {
		...actual,
		default: {
			...actual,
			homedir: () => "/home/user",
		},
		homedir: () => "/home/user",
	}
})

describe("autoImportSettings", () => {
	let autoImportSettings: typeof import("../autoImportSettings").autoImportSettings
	let AUTO_IMPORT_COMPLETED_STATE_KEY: typeof import("../autoImportSettings").AUTO_IMPORT_COMPLETED_STATE_KEY
	let fileExistsAtPathSpy: ReturnType<typeof vi.spyOn>
	let importSettingsFromPathSpy: ReturnType<typeof vi.spyOn>
	let mockProviderSettingsManager: any
	let mockContextProxy: any
	let mockCustomModesManager: any
	let mockOutputChannel: any
	let mockExtensionContext: any

	const deps = () => ({
		providerSettingsManager: mockProviderSettingsManager,
		contextProxy: mockContextProxy,
		customModesManager: mockCustomModesManager,
	})

	beforeEach(async () => {
		vi.resetModules()
		mockGetConfiguration.mockReset()
		mockShowInformationMessage.mockReset()
		mockShowWarningMessage.mockReset()

		mockOutputChannel = { appendLine: vi.fn() }
		mockProviderSettingsManager = { export: vi.fn(), import: vi.fn(), listConfig: vi.fn() }
		mockContextProxy = { setValues: vi.fn(), setValue: vi.fn(), setProviderSettings: vi.fn() }
		mockCustomModesManager = { updateCustomMode: vi.fn() }
		mockExtensionContext = {
			globalState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
			},
		}

		const fsMod = await import("../fs")
		fileExistsAtPathSpy = vi.spyOn(fsMod, "fileExistsAtPath").mockResolvedValue(false)

		const importExportMod = await import("../../core/config/importExport")
		importSettingsFromPathSpy = vi
			.spyOn(importExportMod, "importSettingsFromPath")
			.mockResolvedValue({ success: true } as any)

		const mod = await import("../autoImportSettings")
		autoImportSettings = mod.autoImportSettings
		AUTO_IMPORT_COMPLETED_STATE_KEY = mod.AUTO_IMPORT_COMPLETED_STATE_KEY
	})

	afterEach(() => {
		fileExistsAtPathSpy?.mockRestore()
		importSettingsFromPathSpy?.mockRestore()
	})

	it("should skip auto-import when no settings path is specified", async () => {
		mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue("") })

		await autoImportSettings(mockOutputChannel, deps())

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] No auto-import settings path specified, skipping auto-import",
		)
		expect(importSettingsFromPathSpy).not.toHaveBeenCalled()
	})

	it("should skip auto-import when settings file does not exist", async () => {
		mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue("~/Documents/roo-config.json") })
		fileExistsAtPathSpy.mockResolvedValue(false)

		await autoImportSettings(mockOutputChannel, deps())

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Checking for settings file at: /home/user/Documents/roo-config.json",
		)
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Settings file not found at /home/user/Documents/roo-config.json, skipping auto-import",
		)
		expect(importSettingsFromPathSpy).not.toHaveBeenCalled()
	})

	it("should successfully import settings once and record one-shot marker", async () => {
		mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue("/absolute/path/to/config.json") })
		fileExistsAtPathSpy.mockResolvedValue(true)
		importSettingsFromPathSpy.mockResolvedValue({ success: true } as any)

		await autoImportSettings(mockOutputChannel, deps(), mockExtensionContext)

		expect(fileExistsAtPathSpy).toHaveBeenCalledWith("/absolute/path/to/config.json")
		expect(importSettingsFromPathSpy).toHaveBeenCalledWith("/absolute/path/to/config.json", deps())
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Successfully imported settings from /absolute/path/to/config.json",
		)
		expect(mockShowInformationMessage).toHaveBeenCalledWith("info.auto_import_success")
		expect(mockExtensionContext.globalState.update).toHaveBeenCalledWith(AUTO_IMPORT_COMPLETED_STATE_KEY, true)
	})

	it("should skip re-import when one-shot marker is already set", async () => {
		mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue("/absolute/path/to/config.json") })
		mockExtensionContext.globalState.get.mockReturnValue(true)
		fileExistsAtPathSpy.mockResolvedValue(true)

		await autoImportSettings(mockOutputChannel, deps(), mockExtensionContext)

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Auto-import already completed for this installation; skipping re-import so deleted provider profiles stay deleted",
		)
		expect(importSettingsFromPathSpy).not.toHaveBeenCalled()
		expect(fileExistsAtPathSpy).not.toHaveBeenCalled()
	})

	it("should not set one-shot marker when import fails", async () => {
		mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue("~/config.json") })
		fileExistsAtPathSpy.mockResolvedValue(true)
		importSettingsFromPathSpy.mockResolvedValue({ success: false, error: "bad json" } as any)

		await autoImportSettings(mockOutputChannel, deps(), mockExtensionContext)

		expect(mockExtensionContext.globalState.update).not.toHaveBeenCalled()
		expect(mockShowWarningMessage).toHaveBeenCalledWith(expect.stringContaining("warnings.auto_import_failed"))
	})

	it("should log import warnings while still succeeding and set one-shot marker", async () => {
		mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue("/absolute/path/to/config.json") })
		fileExistsAtPathSpy.mockResolvedValue(true)
		importSettingsFromPathSpy.mockResolvedValue({
			success: true,
			warnings: ['Setting "globalSettings.imageGenerationProvider" used unsupported value "roo"'],
		} as any)

		await autoImportSettings(mockOutputChannel, deps(), mockExtensionContext)

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Successfully imported settings from /absolute/path/to/config.json",
		)
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith("[AutoImport] Import completed with 1 warning.")
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringContaining(
				'[AutoImport] Warning: Setting "globalSettings.imageGenerationProvider" used unsupported value "roo"',
			),
		)
		expect(mockShowInformationMessage).toHaveBeenCalledWith("info.auto_import_success")
		expect(mockExtensionContext.globalState.update).toHaveBeenCalledWith(AUTO_IMPORT_COMPLETED_STATE_KEY, true)
	})

	it("should resolve home directory paths correctly", async () => {
		mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue("~/Documents/config.json") })

		await autoImportSettings(mockOutputChannel, deps())

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Checking for settings file at: /home/user/Documents/config.json",
		)
	})

	it("should handle relative paths by resolving them to home directory", async () => {
		mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue("Documents/config.json") })

		await autoImportSettings(mockOutputChannel, deps())

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Checking for settings file at: /home/user/Documents/config.json",
		)
	})

	it("should handle file system errors gracefully", async () => {
		mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue("~/config.json") })
		fileExistsAtPathSpy.mockRejectedValue(new Error("File system error"))

		await autoImportSettings(mockOutputChannel, deps())

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringContaining("[AutoImport] Unexpected error during auto-import:"),
		)
		expect(importSettingsFromPathSpy).not.toHaveBeenCalled()
	})
})
