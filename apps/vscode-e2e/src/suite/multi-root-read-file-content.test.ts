import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import { RooCodeEventName, type ClineMessage } from "@roo-code/types"

import { setDefaultSuiteTimeout } from "./test-utils"
import { waitFor } from "./utils"

suite("Multi-root readFileContent repro", function () {
	setDefaultSuiteTimeout(this)

	test("should read a file that exists only in the secondary workspace root", async () => {
		await waitFor(() => (vscode.workspace.workspaceFolders?.length ?? 0) >= 2, {
			timeout: 60_000,
			interval: 250,
		})

		const primaryWorkspace = vscode.workspace.workspaceFolders?.[0]
		assert.ok(primaryWorkspace, "Expected a primary workspace folder")
		const secondaryWorkspace = vscode.workspace.workspaceFolders?.[1]
		assert.ok(secondaryWorkspace, "Expected a secondary workspace folder")

		const primaryRoot = primaryWorkspace.uri.fsPath
		const secondaryRoot = secondaryWorkspace.uri.fsPath
		const secondaryFileName = "secondary-root-read-file.txt"
		const expectedContent = "SECONDARY_ROOT_MARKER_204\n"
		const secondaryFilePath = path.join(secondaryRoot, secondaryFileName)

		await fs.writeFile(secondaryFilePath, expectedContent, "utf8")

		const api = globalThis.api
		const messages: ClineMessage[] = []
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.partial !== true) {
				messages.push(message)
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		let taskCompleted = false
		let taskId = ""
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		try {
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text:
					`READ_FILE_MULTI_ROOT_REPRO: Use only the read_file tool to read "${secondaryFileName}". ` +
					`The file exists in the current VS Code workspace, but only inside the secondary workspace root. ` +
					`After the read attempt, explain exactly what happened.`,
			})

			await waitFor(() => taskCompleted, { timeout: 60_000, interval: 250 })

			assert.ok(
				vscode.workspace.workspaceFolders?.some((folder) => folder.uri.fsPath === secondaryRoot),
				`Expected secondary root ${secondaryRoot} to remain part of the workspace during the repro`,
			)

			const completionMessage = messages.find(
				(message) =>
					message.type === "say" &&
					(message.say === "completion_result" || message.say === "text") &&
					message.text?.includes("SECONDARY_ROOT_MARKER_204"),
			)

			assert.ok(
				completionMessage,
				`Expected the task to read the secondary-root file. Primary root was ${primaryRoot}, secondary root was ${secondaryRoot}, secondary file was ${secondaryFilePath}, and messages were ${JSON.stringify(messages, null, 2)}.`,
			)
		} finally {
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)

			try {
				await api.cancelCurrentTask()
			} catch {
				// Ignore cleanup races if the task already ended.
			}

			await fs.rm(secondaryFilePath, { force: true })
		}
	})
})
