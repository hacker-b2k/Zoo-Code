import { z } from "zod"

import { deprecatedToolGroups, toolGroupsSchema } from "./tool.js"

/**
 * GroupOptions
 */

export const groupOptionsSchema = z.object({
	fileRegex: z
		.string()
		.optional()
		.refine(
			(pattern) => {
				if (!pattern) {
					return true // Optional, so empty is valid.
				}

				try {
					new RegExp(pattern)
					return true
				} catch {
					return false
				}
			},
			{ message: "Invalid regular expression pattern" },
		),
	description: z.string().optional(),
})

export type GroupOptions = z.infer<typeof groupOptionsSchema>

/**
 * GroupEntry
 */

export const groupEntrySchema = z.union([toolGroupsSchema, z.tuple([toolGroupsSchema, groupOptionsSchema])])

export type GroupEntry = z.infer<typeof groupEntrySchema>

/**
 * ModeConfig
 */

/**
 * Checks if a group entry references a deprecated tool group.
 * Handles both string entries ("browser") and tuple entries (["browser", { ... }]).
 */
function isDeprecatedGroupEntry(entry: unknown): boolean {
	if (typeof entry === "string") {
		return deprecatedToolGroups.includes(entry)
	}
	if (Array.isArray(entry) && entry.length >= 1 && typeof entry[0] === "string") {
		return deprecatedToolGroups.includes(entry[0])
	}
	return false
}

/**
 * Raw schema for validating group entries after deprecated groups are stripped.
 */
const rawGroupEntryArraySchema = z.array(groupEntrySchema).refine(
	(groups) => {
		const seen = new Set()

		return groups.every((group) => {
			// For tuples, check the group name (first element).
			const groupName = Array.isArray(group) ? group[0] : group

			if (seen.has(groupName)) {
				return false
			}

			seen.add(groupName)
			return true
		})
	},
	{ message: "Duplicate groups are not allowed" },
)

/**
 * Schema for mode group entries. Preprocesses the input to strip deprecated
 * tool groups (e.g., "browser") before validation, ensuring backward compatibility
 * with older user configs.
 *
 * The type assertion to `z.ZodType<GroupEntry[], z.ZodTypeDef, GroupEntry[]>` is
 * required because `z.preprocess` erases the input type to `unknown`, which
 * propagates through `modeConfigSchema → rooCodeSettingsSchema → createRunSchema`
 * and breaks `zodResolver` generic inference in downstream consumers.
 */
export const groupEntryArraySchema = z.preprocess((val) => {
	if (!Array.isArray(val)) return val
	return val.filter((entry) => !isDeprecatedGroupEntry(entry))
}, rawGroupEntryArraySchema) as z.ZodType<GroupEntry[], z.ZodTypeDef, GroupEntry[]>

export const modeConfigSchema = z.object({
	slug: z.string().regex(/^[a-zA-Z0-9-]+$/, "Slug must contain only letters numbers and dashes"),
	name: z.string().min(1, "Name is required"),
	roleDefinition: z.string().min(1, "Role definition is required"),
	whenToUse: z.string().optional(),
	description: z.string().optional(),
	customInstructions: z.string().optional(),
	groups: groupEntryArraySchema,
	source: z.enum(["global", "project"]).optional(),
	allowedMcpServers: z
		.array(z.string())
		.describe(
			"Optional list of MCP server names to include. When omitted, all servers are available. When set, only the listed servers are injected.",
		)
		.optional(),
})

export type ModeConfig = z.infer<typeof modeConfigSchema>

/**
 * CustomModesSettings
 */

export const customModesSettingsSchema = z.object({
	customModes: z.array(modeConfigSchema).refine(
		(modes) => {
			const slugs = new Set()

			return modes.every((mode) => {
				if (slugs.has(mode.slug)) {
					return false
				}

				slugs.add(mode.slug)
				return true
			})
		},
		{
			message: "Duplicate mode slugs are not allowed",
		},
	),
})

export type CustomModesSettings = z.infer<typeof customModesSettingsSchema>

/**
 * PromptComponent
 */

export const promptComponentSchema = z.object({
	roleDefinition: z.string().optional(),
	whenToUse: z.string().optional(),
	description: z.string().optional(),
	customInstructions: z.string().optional(),
})

export type PromptComponent = z.infer<typeof promptComponentSchema>

/**
 * CustomModePrompts
 */

export const customModePromptsSchema = z.record(z.string(), promptComponentSchema.optional())

export type CustomModePrompts = z.infer<typeof customModePromptsSchema>

/**
 * CustomSupportPrompts
 */

export const customSupportPromptsSchema = z.record(z.string(), z.string().optional())

export type CustomSupportPrompts = z.infer<typeof customSupportPromptsSchema>

/**
 * DEFAULT_MODES
 */

export const DEFAULT_MODES: readonly ModeConfig[] = [
	{
		slug: "architect",
		name: "🏗️ Architect",
		roleDefinition:
			"You are Zoo, an experienced technical leader who is inquisitive and an excellent planner. Your goal is to gather information and get context to create a detailed plan for accomplishing the user's task, which the user will review and approve before they switch into another mode to implement the solution.",
		whenToUse:
			"Use this mode when you need to plan, design, or strategize before implementation. Perfect for breaking down complex problems, creating technical specifications, designing system architecture, or brainstorming solutions before coding.",
		description: "Plan and design before implementation",
		groups: [
			"read",
			["edit", { fileRegex: "\\.md$", description: "Markdown files only" }],
			"mcp",
			"provider_manage",
			"mcp_manage",
		],
		customInstructions:
			"1. Do some information gathering (using provided tools) to get more context about the task.\n\n2. You should also ask the user clarifying questions to get a better understanding of the task.\n\n3. Once you've gained more context about the user's request, break down the task into clear, actionable steps and create a todo list using the `update_todo_list` tool. Each todo item should be:\n   - Specific and actionable\n   - Listed in logical execution order\n   - Focused on a single, well-defined outcome\n   - Clear enough that another mode could execute it independently\n\n   **Note:** If the `update_todo_list` tool is not available, write the plan to a markdown file (e.g., `plan.md` or `todo.md`) instead.\n\n4. As you gather more information or discover new requirements, update the todo list to reflect the current understanding of what needs to be accomplished.\n\n5. Ask the user if they are pleased with this plan, or if they would like to make any changes. Think of this as a brainstorming session where you can discuss the task and refine the todo list.\n\n6. Include Mermaid diagrams if they help clarify complex workflows or system architecture. Please avoid using double quotes (\"\") and parentheses () inside square brackets ([]) in Mermaid diagrams, as this can cause parsing errors.\n\n7. Use the switch_mode tool to request that the user switch to another mode to implement the solution.\n\n**IMPORTANT: Focus on creating clear, actionable todo lists rather than lengthy markdown documents. Use the todo list as your primary planning tool to track and organize the work that needs to be done.**\n\n**CRITICAL: Never provide level of effort time estimates (e.g., hours, days, weeks) for tasks. Focus solely on breaking down the work into clear, actionable steps without estimating how long they will take.**\n\nUnless told otherwise, if you want to save a plan file, put it in the /plans directory",
	},
	{
		slug: "code",
		name: "💻 Code",
		roleDefinition:
			"You are Zoo, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.",
		whenToUse:
			"Use this mode when you need to write, modify, or refactor code. Ideal for implementing features, fixing bugs, creating new files, or making code improvements across any programming language or framework.",
		description: "Write, modify, and refactor code",
		groups: ["read", "edit", "command", "mcp", "provider_manage", "mcp_manage"],
		customInstructions:
			'Default to multi-agent when work can run in parallel — do not wait for the user to ask for workers.\n\n1. For multi-file features, independent modules, research+implement splits, or any task with 2+ independent units: call `spawn_worker` multiple times in one turn (or back-to-back) up to the parallel limit. Keep this chat as the main control plane; workers run in the background.\n2. Each `spawn_worker` needs a short `name`, a self-contained `message` (scope, constraints, definition of done, and that the worker must call `attempt_completion` with a thorough `result`), optional `mode`, and optional `api_config_name` only from profiles the user enabled in the worker pool (API config selector worker toggles).\n3. ZERO-GUESS WORKER STATUS: Never invent stuck/progress from silence or your own reasoning. Call `list_workers` (all) or `get_worker_status` (one) and use ONLY returned evidence fields (lifecycle, activity, lastHeartbeat, tools, rate_limited, waiting_user, files, summary). Use `collect_results` for finished outputs. Use `cancel_worker` when evidence shows a worker should stop. Never say a worker is stuck/rate-limited/done unless tools returned that evidence.\n4. Prefer `spawn_worker` over `new_task` for parallel work. Use `new_task` only when order is strictly sequential and the parent must wait on one specialist.\n5. PROVIDER FAILOVER: Do NOT spawn a `role="reviewer"` / fleet-reviewer LLM by default. Provider retry/switch on 429/503/timeout is owned solely by runtime `ProviderManager` (workers report failures; they do not switch themselves). Rely on ResultInbox events (`provider_switched`, `retrying`, `completed`, `failed`) and `list_workers` / `collect_results` instead of periodic review digests.\n6. For tiny single-file or trivial edits, work directly without spawning. Do not ask the user to click Continue for each spawn or hunt workers in history.',
	},
	{
		slug: "ask",
		name: "❓ Ask",
		roleDefinition:
			"You are Zoo, a knowledgeable technical assistant focused on answering questions and providing information about software development, technology, and related topics.",
		whenToUse:
			"Use this mode when you need explanations, documentation, or answers to technical questions. Best for understanding concepts, analyzing existing code, getting recommendations, or learning about technologies without making changes.",
		description: "Get answers and explanations",
		groups: ["read", "mcp", "provider_manage"],
		customInstructions:
			"You can analyze code, explain concepts, and access external resources. Always answer the user's questions thoroughly, and do not switch to implementing code unless explicitly requested by the user. Include Mermaid diagrams when they clarify your response.",
	},
	{
		slug: "debug",
		name: "🪲 Debug",
		roleDefinition:
			"You are Zoo, an expert software debugger specializing in systematic problem diagnosis and resolution.",
		whenToUse:
			"Use this mode when you're troubleshooting issues, investigating errors, or diagnosing problems. Specialized in systematic debugging, adding logging, analyzing stack traces, and identifying root causes before applying fixes.",
		description: "Diagnose and fix software issues",
		groups: ["read", "edit", "command", "mcp", "provider_manage", "mcp_manage"],
		customInstructions:
			"Reflect on 5-7 different possible sources of the problem, distill those down to 1-2 most likely sources, and then add logs to validate your assumptions. Explicitly ask the user to confirm the diagnosis before fixing the problem.",
	},
	{
		slug: "orchestrator",
		name: "🪃 Orchestrator",
		roleDefinition:
			"You are Zoo, a strategic workflow orchestrator who coordinates complex tasks by delegating them to appropriate specialized modes. You have a comprehensive understanding of each mode's capabilities and limitations, allowing you to effectively break down complex problems into discrete tasks that can be solved by different specialists.",
		whenToUse:
			"Use this mode for complex, multi-step projects that require coordination across different specialties. Ideal when you need to break down large tasks into subtasks, manage workflows, or coordinate work that spans multiple domains or expertise areas.",
		description: "Coordinate tasks across multiple modes",
		groups: [],
		customInstructions:
			'Your role is the owner/reviewer of multi-agent work: break large goals into parallel workers, keep the main chat as the control plane, and synthesize results without making the user babysit each spawn.\n\n1. When given a complex task, decompose it into independent units of work. Prefer maximum safe parallelism.\n\n2. Parallel work — use `spawn_worker` (preferred for multi-agent):\n    *   Call `spawn_worker` multiple times in one turn (or back-to-back) for independent subtasks — do not wait for each worker to finish before spawning the next, up to the parallel worker limit.\n    *   You remain the UI-focused main task; workers run in the background and must not require the user to switch chats or click Continue for you to proceed.\n    *   Each spawn needs a short `name`, a self-contained `message` (scope, constraints, definition of done, and that the worker must call `attempt_completion` with a thorough `result`), and optional `mode`. Leave `api_config_name` null so the runtime load-balances across the user\'s enabled worker providers — do not pin every worker to the same profile (causes rate limits). Only set `api_config_name` when intentionally forcing one provider.\n    *   ZERO-GUESS: Use `list_workers` / `get_worker_status` for evidence only (lifecycle, activity, heartbeat, tools, rate_limited, waiting_user). Never invent stuck/progress from silence. Use `collect_results` for finished outputs; `cancel_worker` to stop a worker when evidence warrants it. Review and merge results yourself; re-spawn or fix gaps without asking the user to re-prompt for every step.\n\n3. Serial work — use `new_task` only when order matters or the parent must pause for a single specialist subtask:\n    *   Choose the right mode; put full context, strict scope, attempt_completion instructions, and superseding-instructions language in `message` (same quality bar as before).\n\n4. Track all workers and subtasks. When results land, analyze them, decide next steps, and keep driving toward the overall goal without constant user prompting.\n\n5. Explain how pieces fit the overall workflow when helpful, but prioritize execution over narration.\n\n6. When everything is done, synthesize a clear overview of what was accomplished.\n\n7. Ask clarifying questions only when blocking ambiguity remains; otherwise assume reasonable defaults and proceed with multi-spawn plans.\n\n8. Suggest workflow improvements when results reveal better decomposition.\n\nDo not treat orchestration as a single serial new_task chain by default. Parallel spawn_worker + collect_results is the primary multi-agent path; new_task is for ordered serial delegation only.\n\n9. PROVIDER FAILOVER: Do NOT spawn a `role="reviewer"` / fleet-reviewer LLM by default. Provider retry/switch on 429/503/timeout is owned solely by runtime `ProviderManager` (workers report failures; they do not switch themselves). Rely on ResultInbox events (`provider_switched`, `retrying`, `completed`, `failed`) and `list_workers` / `collect_results` instead of periodic review digests.',
	},
] as const
