import * as assert from "assert"
import * as fs from "fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "http"
import * as path from "path"
import * as vscode from "vscode"

import { RooCodeEventName } from "@roo-code/types"

import { setDefaultSuiteTimeout } from "./test-utils"
import { sleep, waitFor } from "./utils"

type CapturedAnthropicRequest = {
	messages: Array<{
		role?: string
		content?: unknown
	}>
}

type ToolUseSpec = {
	id: string
	name: string
	input: Record<string, unknown>
}

function readRequestBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
		req.on("error", reject)
	})
}

function writeSse(res: ServerResponse, event: unknown) {
	const eventName =
		typeof event === "object" && event !== null && "type" in event
			? String((event as { type: string }).type)
			: "message"
	res.write(`event: ${eventName}\n`)
	res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function writeAnthropicToolUseResponse(res: ServerResponse, model: string, toolUses: ToolUseSpec[]) {
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	})

	writeSse(res, {
		type: "message_start",
		message: {
			id: "msg_repro_190_tools",
			type: "message",
			role: "assistant",
			content: [],
			model,
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		},
	})

	for (const [index, toolUse] of toolUses.entries()) {
		writeSse(res, {
			type: "content_block_start",
			index,
			content_block: {
				type: "tool_use",
				id: toolUse.id,
				name: toolUse.name,
				input: {},
			},
		})
		writeSse(res, {
			type: "content_block_delta",
			index,
			delta: {
				type: "input_json_delta",
				partial_json: JSON.stringify(toolUse.input),
			},
		})
		writeSse(res, { type: "content_block_stop", index })
	}

	writeSse(res, {
		type: "message_delta",
		delta: { stop_reason: "tool_use", stop_sequence: null },
		usage: { output_tokens: 1 },
	})
	writeSse(res, { type: "message_stop" })
	res.end()
}

function writeAnthropicAttemptCompletionResponse(res: ServerResponse, model: string) {
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	})

	writeSse(res, {
		type: "message_start",
		message: {
			id: "msg_repro_190_done",
			type: "message",
			role: "assistant",
			content: [],
			model,
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		},
	})
	writeSse(res, {
		type: "content_block_start",
		index: 0,
		content_block: {
			type: "tool_use",
			id: "toolu_repro_190_done",
			name: "attempt_completion",
			input: {},
		},
	})
	writeSse(res, {
		type: "content_block_delta",
		index: 0,
		delta: {
			type: "input_json_delta",
			partial_json: JSON.stringify({ result: "ANTHROPIC_TOOL_RESULTS_REPRO_DONE" }),
		},
	})
	writeSse(res, { type: "content_block_stop", index: 0 })
	writeSse(res, {
		type: "message_delta",
		delta: { stop_reason: "tool_use", stop_sequence: null },
		usage: { output_tokens: 1 },
	})
	writeSse(res, { type: "message_stop" })
	res.end()
}

async function withAnthropicReproServer<T>(
	run: (args: { baseUrl: string; requests: CapturedAnthropicRequest[]; toolUses: ToolUseSpec[] }) => Promise<T>,
) {
	const requests: CapturedAnthropicRequest[] = []
	const toolUses: ToolUseSpec[] = [
		{
			id: "toolu_repro_190_read_1",
			name: "read_file",
			input: { path: "anthropic-tool-results-repro/file-1.txt" },
		},
		{
			id: "toolu_repro_190_read_2",
			name: "read_file",
			input: { path: "anthropic-tool-results-repro/file-2.txt" },
		},
		{
			id: "toolu_repro_190_read_3",
			name: "read_file",
			input: { path: "anthropic-tool-results-repro/file-3.txt" },
		},
		{
			id: "toolu_repro_190_read_4",
			name: "read_file",
			input: { path: "anthropic-tool-results-repro/file-4.txt" },
		},
	]

	const server = createServer(async (req, res) => {
		if (req.method !== "POST" || req.url !== "/v1/messages") {
			res.writeHead(404)
			res.end("Not found")
			return
		}

		const rawBody = await readRequestBody(req)
		const body = JSON.parse(rawBody) as CapturedAnthropicRequest & { model?: string }
		requests.push({ messages: body.messages ?? [] })

		if (requests.length === 1) {
			writeAnthropicToolUseResponse(res, body.model ?? "claude-opus-4-7", toolUses)
			return
		}

		writeAnthropicAttemptCompletionResponse(res, body.model ?? "claude-opus-4-7")
	})

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
	const address = server.address()
	if (!address || typeof address === "string") {
		throw new Error("Failed to start Anthropic repro server")
	}

	try {
		return await run({
			baseUrl: `http://127.0.0.1:${address.port}`,
			requests,
			toolUses,
		})
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
	}
}

function getLastUserMessage(messages: CapturedAnthropicRequest["messages"]) {
	return [...messages].reverse().find((message) => message.role === "user")
}

function extractToolResultIds(content: unknown): string[] {
	if (!Array.isArray(content)) {
		return []
	}

	return content
		.filter(
			(block): block is { type: "tool_result"; tool_use_id: string } =>
				typeof block === "object" &&
				block !== null &&
				"type" in block &&
				(block as { type?: string }).type === "tool_result",
		)
		.map((block) => block.tool_use_id)
}

suite("Anthropic tool_result repro", function () {
	setDefaultSuiteTimeout(this)
	this.timeout(8 * 60_000)

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

	if (!workspaceRoot) {
		throw new Error("No workspace root found for Anthropic tool_result repro")
	}

	const fixtureDir = path.join(workspaceRoot, "anthropic-tool-results-repro")
	const fixtureFiles = [
		path.join(fixtureDir, "file-1.txt"),
		path.join(fixtureDir, "file-2.txt"),
		path.join(fixtureDir, "file-3.txt"),
		path.join(fixtureDir, "file-4.txt"),
	]

	suiteSetup(async () => {
		await fs.rm(fixtureDir, { recursive: true, force: true })
		await fs.mkdir(fixtureDir, { recursive: true })
		await Promise.all(
			fixtureFiles.map((filePath, index) =>
				fs.writeFile(filePath, `anthropic repro file ${index + 1}\n`, "utf8"),
			),
		)
	})

	suiteTeardown(async () => {
		await fs.rm(fixtureDir, { recursive: true, force: true })

		const aimockUrl = process.env.AIMOCK_URL
		const isRecord = process.env.AIMOCK_RECORD === "true"
		await globalThis.api.setConfiguration({
			apiProvider: "openrouter" as const,
			openRouterApiKey: aimockUrl && !isRecord ? "mock-key" : process.env.OPENROUTER_API_KEY!,
			openRouterModelId: "openai/gpt-4.1",
			...(aimockUrl && { openRouterBaseUrl: `${aimockUrl}/v1` }),
		})
	})

	test("should send matching tool_result blocks after a four-tool Anthropic response", async () => {
		const api = globalThis.api
		let taskCompleted = false
		let taskId: string | undefined

		const onTaskCompleted = (completedTaskId: string) => {
			if (completedTaskId === taskId) {
				taskCompleted = true
			}
		}

		api.on(RooCodeEventName.TaskCompleted, onTaskCompleted)

		try {
			await withAnthropicReproServer(async ({ baseUrl, requests, toolUses }) => {
				await api.setConfiguration({
					apiProvider: "anthropic" as const,
					apiKey: "mock-key",
					apiModelId: "claude-opus-4-7",
					anthropicBaseUrl: baseUrl,
				})

				taskId = await api.startNewTask({
					configuration: {
						mode: "code",
						autoApprovalEnabled: true,
						alwaysAllowReadOnly: true,
						alwaysAllowReadOnlyOutsideWorkspace: true,
						disabledTools: ["execute_command", "read_command_output"],
					},
					text:
						"anthropic-tool-results-repro: use only read_file to read the four files in anthropic-tool-results-repro " +
						"and then report that you finished. Do not run shell commands.",
				})

				await waitFor(() => taskCompleted || requests.length >= 2, { timeout: 120_000, interval: 250 })
				await waitFor(() => requests.length >= 2, { timeout: 30_000, interval: 250 })

				if (!taskCompleted) {
					await waitFor(() => taskCompleted, { timeout: 30_000, interval: 250 })
				}

				const secondRequest = requests[1]
				assert.ok(secondRequest, "Expected Anthropic repro to issue a second /v1/messages request")

				const lastUserMessage = getLastUserMessage(secondRequest.messages)
				const presentToolResultIds = extractToolResultIds(lastUserMessage?.content)
				const expectedToolUseIds = toolUses.map((toolUse) => toolUse.id)

				assert.deepStrictEqual(
					presentToolResultIds,
					expectedToolUseIds,
					`Expected matching tool_result IDs in the second Anthropic request.\nexpected=${JSON.stringify(expectedToolUseIds)}\nactual=${JSON.stringify(presentToolResultIds)}\nlastUser=${JSON.stringify(lastUserMessage?.content)}`,
				)
			})
		} finally {
			api.off(RooCodeEventName.TaskCompleted, onTaskCompleted)

			if (taskId && !taskCompleted) {
				try {
					await api.cancelCurrentTask()
				} catch {
					// Best effort cleanup only.
				}
				await sleep(500)
			}
		}
	})
})
