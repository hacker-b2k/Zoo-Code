import * as vscode from "vscode"
import * as path from "path"
import * as os from "os"

import { Package } from "../shared/package"
import { fileExistsAtPath } from "./fs"
import { t } from "../i18n"

import { importSettingsFromPath, ImportOptions } from "../core/config/importExport"

/** Extension globalState key: auto-import is one-shot so deleted profiles stay deleted. */
export const AUTO_IMPORT_COMPLETED_STATE_KEY = "zooCodeAutoImportCompleted"

/**
 * Automatically imports ZooCode settings from a specified path if it exists.
 * This function is called during extension activation to allow users to pre-configure
 * their settings by placing a settings file at a predefined location.
 *
 * Auto-import is intentionally one-shot: after a successful import, it will not run
 * again for this installation. Re-importing on every activation merged a seed file
 * (e.g. demo free providers) back into provider storage, so deleted profiles reappeared
 * after reload / reinstall of the extension while the VS Code user setting still pointed
 * at the seed file.
 */
export async function autoImportSettings(
	outputChannel: vscode.OutputChannel,
	{ providerSettingsManager, contextProxy, customModesManager }: ImportOptions,
	extensionContext?: vscode.ExtensionContext,
): Promise<void> {
	try {
		// Get the auto-import settings path from VSCode settings
		const settingsPath = vscode.workspace.getConfiguration(Package.name).get<string>("autoImportSettingsPath")

		if (!settingsPath || settingsPath.trim() === "") {
			outputChannel.appendLine("[AutoImport] No auto-import settings path specified, skipping auto-import")
			return
		}

		if (extensionContext?.globalState.get<boolean>(AUTO_IMPORT_COMPLETED_STATE_KEY)) {
			outputChannel.appendLine(
				"[AutoImport] Auto-import already completed for this installation; skipping re-import so deleted provider profiles stay deleted",
			)
			return
		}

		// Resolve the path (handle ~ for home directory and relative paths)
		const resolvedPath = resolvePath(settingsPath.trim())
		outputChannel.appendLine(`[AutoImport] Checking for settings file at: ${resolvedPath}`)

		// Check if the file exists
		if (!(await fileExistsAtPath(resolvedPath))) {
			outputChannel.appendLine(`[AutoImport] Settings file not found at ${resolvedPath}, skipping auto-import`)
			return
		}

		// Attempt to import the configuration
		const result = await importSettingsFromPath(resolvedPath, {
			providerSettingsManager,
			contextProxy,
			customModesManager,
		})

		if (result.success) {
			// Persist one-shot marker before notifying so a later crash mid-notify
			// does not re-import and resurrect deleted profiles.
			if (extensionContext) {
				await extensionContext.globalState.update(AUTO_IMPORT_COMPLETED_STATE_KEY, true)
			}

			outputChannel.appendLine(`[AutoImport] Successfully imported settings from ${resolvedPath}`)

			if (result.warnings && result.warnings.length > 0) {
				const count = result.warnings.length
				outputChannel.appendLine(
					`[AutoImport] Import completed with ${count} warning${count === 1 ? "" : "s"}.`,
				)
				for (const warning of result.warnings) {
					outputChannel.appendLine(`[AutoImport] Warning: ${warning}`)
				}
			}

			// Show a notification to the user
			vscode.window.showInformationMessage(
				t("common:info.auto_import_success", { filename: path.basename(resolvedPath) }),
			)
		} else {
			outputChannel.appendLine(`[AutoImport] Failed to import settings: ${result.error}`)

			// Show a warning but don't fail the extension activation
			vscode.window.showWarningMessage(t("common:warnings.auto_import_failed", { error: result.error }))
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		outputChannel.appendLine(`[AutoImport] Unexpected error during auto-import: ${errorMessage}`)

		// Log error but don't fail extension activation
		console.warn("Auto-import settings error:", error)
	}
}

/**
 * Resolves a file path, handling home directory expansion and relative paths
 */
function resolvePath(settingsPath: string): string {
	// Handle home directory expansion
	if (settingsPath.startsWith("~/")) {
		return path.join(os.homedir(), settingsPath.slice(2))
	}

	// Handle absolute paths
	if (path.isAbsolute(settingsPath)) {
		return settingsPath
	}

	// Handle relative paths (relative to home directory for safety)
	return path.join(os.homedir(), settingsPath)
}
