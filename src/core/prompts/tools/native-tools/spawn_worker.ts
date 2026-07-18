import type OpenAI from "openai"

const DESCRIPTION = `Spawn a background worker that runs in parallel with the main orchestrator (YOU stay the boss in the UI).

Unlike new_task (serial subtask that pauses the parent), spawn_worker:
- Keeps the main task active and focused in the UI (workers never steal chat focus)
- Runs the worker off-stack; switching chats does not abort workers
- Delivers results via the result inbox (collect_results)
- Provider assignment: leave api_config_name null so the runtime load-balances across user-enabled worker providers (recommended for parallel spawns). Only set api_config_name when you intentionally pin one profile. Failover on rate-limit/quota is automatic via ProviderManager across the enabled pool — workers do not switch themselves. Do not spawn a separate LLM "fleet-reviewer" for provider failover.

role="worker" (default): implementer — builds/edits per message.
role="reviewer": LEGACY/optional only — do NOT spawn by default. Always-on watch+digest was removed as default multi-agent policy because it creates chat spam and duplicates monitoring. Prefer runtime ResultInbox events (provider_switched, completed, failed, retrying). Leave role null/"worker".

When work can be parallelized, prefer multiple spawn_worker calls (up to the parallel worker limit) over serial new_task. Do NOT assign every worker the same api_config_name (that causes rate limits).
Use list_workers to check status and collect_results to drain completed/failed outputs. Use new_task only for ordered serial subtasks that must pause the parent.`

export default {
	type: "function",
	function: {
		name: "spawn_worker",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Short worker label (e.g. implement-auth, review-pr)",
				},
				message: {
					type: "string",
					description: "Full instructions / context for the worker task",
				},
				mode: {
					type: ["string", "null"],
					description: "Optional mode slug (code, debug, architect). Defaults to current mode.",
				},
				api_config_name: {
					type: ["string", "null"],
					description:
						"Optional pin to one provider profile (does not switch UI). Prefer null so the runtime spreads workers across the user-enabled worker pool (load balance). Setting the same name on every spawn causes rate limits.",
				},
				fallback_api_config_names: {
					type: ["string", "null"],
					description:
						"Optional comma-separated or JSON array of extra fallback profile names. Usually null — the enabled worker pool is used automatically for failover.",
				},
				role: {
					type: ["string", "null"],
					description:
						'Optional: "worker" (default implementer). "reviewer" is legacy/optional only — do not spawn by default; provider failover is owned by ProviderManager.',
				},
				review_target_id: {
					type: ["string", "null"],
					description:
						"Legacy: only when role=reviewer (not recommended). Optional workerId to emphasize in digests.",
				},
			},
			required: [
				"name",
				"message",
				"mode",
				"api_config_name",
				"fallback_api_config_names",
				"role",
				"review_target_id",
			],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
