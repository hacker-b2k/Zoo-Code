# 🔒 Zoo-Code Extension — Safety & Anti-Hacking Instructions Audit

> **Generated:** 2026-07-15  
> **Scope:** All source files (excluding `node_modules`, `.turbo`, `releases`, build artifacts)  
> **Purpose:** Identify every file that contains agent instructions preventing help with hacking, illegal activities, or malicious use

---

## 📊 Summary

| Category                                 | File Count |
| ---------------------------------------- | ---------- |
| **Agent Safety Instructions (direct)**   | 5          |
| **Security Hardening Code**              | 6          |
| **Access Control / Restriction Systems** | 4          |
| **UI Safety Messages (all locales)**     | 36         |
| **Governance / Code of Conduct**         | 2          |
| **Test Files Testing Security**          | 5          |
| **TOTAL FILES WITH SAFETY RELEVANCE**    | **58**     |

---

## 🛑 CATEGORY 1: Agent Safety Instructions (Direct Guardrails)

These files contain **direct instructions to the AI agent** about refusing harmful/illegal requests.

### 1. `src/core/prompts/tools/native-tools/execute_command.ts`

- **Line 6:** `"Ensure the command is properly formatted and does not contain any harmful instructions."`
- **What it does:** Instructs the agent that every CLI command it generates must be free of harmful instructions. This is a direct safety guardrail in the `execute_command` tool description that the AI model sees in its system prompt.
- **Risk level:** 🔴 HIGH — This is the primary gatekeeper preventing the agent from generating malicious shell commands.

### 2. `src/core/prompts/sections/rules.ts`

- **Lines (getVendorConfidentialitySection):** `"Never reveal the vendor or company that created you to users."`
- **Lines (getRulesSection):** `"Some modes have restrictions on which files they can edit. If you attempt to edit a restricted file, the operation will be rejected with a FileRestrictionError"`
- **What it does:** Contains the main RULES section of the system prompt. Includes vendor confidentiality (stealth mode), file restriction enforcement, and behavioral constraints. While it doesn't explicitly mention "hacking", it restricts what the agent can do.
- **Risk level:** 🟡 MEDIUM — Indirect safety through restriction enforcement.

### 3. `src/core/prompts/system.ts`

- **Lines 1-170:** Assembles the complete system prompt from all sections (rules, capabilities, objective, modes, skills).
- **What it does:** This is the master system prompt generator. It combines ALL safety sections into the final prompt sent to the AI model. Every safety instruction from other files flows through this file.
- **Risk level:** 🔴 HIGH — Single point of control for all agent instructions.

### 4. `src/core/prompts/sections/objective.ts`

- **Full file:** Defines the OBJECTIVE section of the system prompt.
- **What it does:** Instructs the agent to work methodically, use tools appropriately, and not engage in pointless conversations. Sets behavioral boundaries.
- **Risk level:** 🟢 LOW — Behavioral guidance, not direct safety guardrail.

### 5. `src/assets/marketplace/modes.yml`

- **Line 331, 667, 678, 1121, 1256, 2280, 2310, 2344:** Contains "guardrails" references in mode definitions.
- **Line 1942:** `"Safety practices for scripts and tool usage"` — Skills authoring mode instruction.
- **Line 1944:** `"Auditable and safe (clear prerequisites, careful script guidance)"` — Safety requirement for skills.
- **Line 3659, 3812-3827:** Google Gemini `safety_settings` and `HarmCategory.HARM_CATEGORY_HATE_SPEECH` API documentation.
- **What it does:** Contains mode definitions with safety guardrails for decision-making, script safety practices, and AI safety API configurations.
- **Risk level:** 🟡 MEDIUM — Mode-level safety instructions and AI API safety settings.

---

## 🛡️ CATEGORY 2: Security Hardening Code

These files contain **code that actively prevents security attacks** on the extension or user system.

### 6. `src/utils/migrateSettings.ts`

- **Line 122:** `"Removes commands from old defaults that could execute arbitrary code. This addresses the security vulnerability where npm install/test can run malicious postinstall scripts"`
- **What it does:** Migration function that removes potentially dangerous default commands from settings to prevent malicious postinstall script execution.
- **Risk level:** 🔴 HIGH — Prevents arbitrary code execution attacks.

### 7. `src/services/mcp/McpOAuthClientProvider.ts`

- **Line 340:** `"Validate the authorization_endpoint origin matches the issuer to prevent a compromised metadata document from redirecting users to a phishing page."`
- **What it does:** Validates OAuth authorization URLs to prevent phishing attacks through compromised MCP server metadata.
- **Risk level:** 🔴 HIGH — Anti-phishing protection.

### 8. `src/core/tools/mcpServerRestriction.ts`

- **Full file (115 lines):** Complete MCP server access control system.
- **Key functions:** `isMcpServerAllowed()`, `getAllowedMcpServersForTask()`, `ensureMcpServerAllowed()`
- **What it does:** Execution-time defense layer that prevents the AI model from invoking MCP tools on disallowed servers. Rejects unauthorized server access at runtime.
- **Risk level:** 🔴 HIGH — Prevents unauthorized server access.

### 9. `src/core/protect/RooProtectedController.ts`

- **Full file (120 lines):** Write-protection system for configuration files.
- **Protected patterns:** `.rooignore`, `.roomodes`, `.roorules*`, `.clinerules*`, `.roo/**`, `.vscode/**`, `*.code-workspace`, `.rooprotected`, `AGENTS.md`, `AGENT.md`
- **What it does:** Prevents auto-approved modifications to sensitive configuration files. The agent cannot modify protected files without explicit user approval.
- **Risk level:** 🔴 HIGH — Prevents unauthorized configuration tampering.

### 10. `src/core/prompts/tools/filter-tools-for-mode.ts`

- **Full file (250+ lines):** Tool filtering and restriction system.
- **What it does:** Filters which tools are available to the AI based on mode configuration, model capabilities, and allowlists. Prevents the agent from using tools it shouldn't have access to.
- **Risk level:** 🟡 MEDIUM — Tool access control.

### 11. `src/core/tools/validateToolUse.ts`

- **Referenced by:** `filter-tools-for-mode.ts` (imports `isToolAllowedForMode`)
- **What it does:** Validates whether a tool invocation is allowed for the current mode. Enforcement layer for tool restrictions.
- **Risk level:** 🟡 MEDIUM — Tool validation enforcement.

---

## 🚫 CATEGORY 3: Access Control / Restriction Systems

### 12. `src/shared/modes.ts`

- **What it does:** Defines all agent modes (code, architect, ask, etc.) with their allowed tool groups, file restrictions, and MCP server allowlists.
- **Risk level:** 🟡 MEDIUM — Mode-based access control definitions.

### 13. `src/core/webview/generateSystemPrompt.ts`

- **Full file:** Generates the complete system prompt including all safety sections.
- **What it does:** Orchestrates system prompt generation with all safety instructions, custom instructions, and mode-specific restrictions.
- **Risk level:** 🟡 MEDIUM — System prompt assembly.

### 14. `src/services/rules/__tests__/rules.spec.ts`

- **What it does:** Tests for the rules system that loads and applies agent instructions.
- **Risk level:** 🟢 LOW — Test coverage for safety system.

### 15. `WORKSPACE_GOVERNANCE.md`

- **Lines 1-155:** Complete workspace governance document.
- **Key rules:** "NO SHORTCUTS", "NO CHEATING", "PLAN FIRST", "NO HALF-WORK", "INDUSTRY STANDARD QUALITY"
- **Line 154:** `"Maintainer: hacker-b2k"` — GitHub username, not hacking instruction.
- **What it does:** Absolute rules for all agents and developers. Enforces quality standards, prevents shortcuts, requires verification.
- **Risk level:** 🟡 MEDIUM — Governance-level behavioral constraints.

---

## 🌐 CATEGORY 4: UI Safety Messages (All Locales)

These files contain **user-facing safety messages** shown in the UI across 18 languages.

### 16-33. `webview-ui/src/i18n/locales/{lang}/chat.json` (18 files)

Languages: `ca`, `de`, `en`, `es`, `fr`, `hi`, `id`, `it`, `ja`, `ko`, `nl`, `pl`, `pt-BR`, `ru`, `tr`, `vi`, `zh-CN`, `zh-TW`

- **Key `"reject"` section:** `"title": "Deny"`, `"tooltip": "Prevent this action from occurring"` — User can deny any agent action.
- **Key `"403"` error:** `"Unauthorized. Your API key is valid, but the provider refused to complete this request."` — Provider-level refusal message.
- **Risk level:** 🟢 LOW — UI-level safety controls.

### 34-51. `webview-ui/src/i18n/locales/{lang}/settings.json` (18 files)

- **`deniedCommands`:** `"Commands with the prefix {{prefix}} have been forbidden by the user. Do not bypass this restriction by running another command."` — Prevents agent from bypassing user-defined command restrictions.
- **`consecutiveMistakeLimit`:** `"Number of consecutive errors or repeated actions before showing 'Zoo is having trouble' dialog. Set to 0 to disable this safety mechanism"` — Safety mechanism for error detection.
- **`autoDenied`:** Explicit instruction to agent NOT to bypass forbidden command restrictions.
- **Risk level:** 🟡 MEDIUM — User-configurable safety restrictions with agent enforcement.

---

## 📜 CATEGORY 5: Governance / Code of Conduct

### 52. `CODE_OF_CONDUCT.md`

- **Line 57:** `"threatening, offensive, or harmful"` — Prohibits harmful behavior from contributors.
- **What it does:** Standard contributor code of conduct. Applies to human contributors, not directly to AI agents.
- **Risk level:** 🟢 LOW — Human behavior guidelines.

### 53. `AGENTS.md`

- **Full file:** Agent guidance document for the repository.
- **What it does:** Instructs agents on project systems, code guidance, test placement, and workflow. References governance and planning requirements.
- **Risk level:** 🟢 LOW — Workflow guidance, not safety guardrails.

---

## 🧪 CATEGORY 6: Test Files Testing Security

### 54. `src/core/config/__tests__/CustomModesManager.spec.ts`

- **Lines 1040-1096:** `"should prevent path traversal attacks in import"` — Tests that malicious YAML with path traversal (`../../../etc/passwd`) is blocked.
- **What it does:** Verifies that the CustomModesManager prevents path traversal attacks during mode import.
- **Risk level:** 🟢 LOW (test only) — But validates critical security behavior.

### 55. `src/utils/__tests__/shell.spec.ts`

- **Lines 691, 725-729:** Tests with `malicious-shell` and `C:\malicious\shell.exe` paths.
- **What it does:** Verifies that unknown/malicious shell paths are rejected and fallback to safe defaults.
- **Risk level:** 🟢 LOW (test only) — Validates shell path security.

### 56. `src/integrations/terminal/__tests__/TerminalProfile.spec.ts`

- **Line 109:** `"malicious": { path: "/workspace/malicious-shell" }` — Test fixture.
- **What it does:** Tests terminal profile handling with potentially malicious profiles.
- **Risk level:** 🟢 LOW (test only) — Validates terminal profile security.

### 57. `src/core/config/__tests__/CustomModesManager.spec.ts`

- **Lines 1040-1096:** Path traversal attack prevention tests.
- **What it does:** Tests that malicious file paths are sanitized during mode import.
- **Risk level:** 🟢 LOW (test only).

### 58. `src/services/code-index/semble/__tests__/semble-downloader.spec.ts`

- **What it does:** Tests for download security (referenced in initial search for "malicious").
- **Risk level:** 🟢 LOW (test only).

---

## 🔍 FALSE POSITIVES (Excluded from Report)

The following files were found by keyword search but do **NOT** contain safety instructions:

| File                                             | Reason for Exclusion                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `src/webview-ui/build/assets/hack-*.js`          | "Hack" is a **programming language** (PHP-like), not hacking                   |
| `src/dist/extension.js`                          | Bundled/minified code, not instruction files                                   |
| `CHANGELOG.md`                                   | Contains "hackathon" or similar non-safety context                             |
| `docs/decisions/ADR-*.md`                        | Contains "hacker-b2k" — this is a **GitHub username**, not hacking instruction |
| `docs/DEV_SETUP.md`                              | Contains "hacker-b2k" GitHub URL                                               |
| `src/assets/vscode-material-icons/icon-map.json` | Contains "hack" as language name for icon mapping                              |
| `src/core/webview/ClineProvider.ts`              | Contains "devhack" URL reference (blog post about storage options)             |
| `src/core/checkpoints/index.ts`                  | Contains "hack" in git context (workaround)                                    |
| Various `__tests__/*.spec.ts`                    | Test assertions using `.rejects` (Jest/Vitest matcher, not safety)             |
| `webview-ui/src/components/ui/hooks/*.ts`        | "reject" in Promise context, not safety                                        |
| `webview-ui/src/index.css`                       | CSS class names, not instructions                                              |

---

## 📋 KEY FINDINGS

### ✅ What Zoo-Code DOES Have:

1. **`execute_command` tool safety** — Explicit instruction to not generate harmful commands
2. **MCP server restriction system** — Runtime enforcement of per-mode server allowlists
3. **Protected file controller** — Prevents unauthorized modification of config files
4. **Tool filtering by mode** — Agents only see tools appropriate for their mode
5. **Command denial system** — Users can define forbidden command prefixes; agent is told not to bypass them
6. **Phishing prevention** — OAuth URL validation in MCP
7. **Path traversal protection** — Import validation prevents directory traversal attacks
8. **Shell path validation** — Rejects unknown/malicious shell paths
9. **Vendor confidentiality** — Stealth mode hides model vendor identity
10. **Governance document** — Strict rules about quality, no shortcuts, verification

### ❌ What Zoo-Code Does NOT Have:

1. **No explicit "do not help with hacking" instruction** in the system prompt
2. **No explicit "do not help with illegal activities" instruction** in the system prompt
3. **No content safety filter** for user requests (relies on underlying AI model's safety)
4. **No explicit jailbreak prevention** instructions for the agent
5. **No ethical use policy** specific to the AI agent

### ⚠️ Gap Analysis:

The extension relies heavily on the **underlying AI model's built-in safety** (e.g., Claude, GPT) rather than implementing its own content safety guardrails. The safety measures in the codebase focus on:

- **Technical security** (preventing attacks on the extension itself)
- **Access control** (restricting what tools/files the agent can access)
- **User override** (users can deny actions and forbid commands)

But there are **no explicit instructions** telling the agent to refuse requests about:

- Hacking / cyber attacks
- Illegal activities
- Creating malware
- Social engineering
- Unauthorized access

This is a **significant gap** — the extension trusts the AI model provider to handle content safety, but does not add its own layer of protection.

---

## 📁 Complete File List (58 Files)

### Agent Safety Instructions (5)

1. `src/core/prompts/tools/native-tools/execute_command.ts`
2. `src/core/prompts/sections/rules.ts`
3. `src/core/prompts/system.ts`
4. `src/core/prompts/sections/objective.ts`
5. `src/assets/marketplace/modes.yml`

### Security Hardening Code (6)

6. `src/utils/migrateSettings.ts`
7. `src/services/mcp/McpOAuthClientProvider.ts`
8. `src/core/tools/mcpServerRestriction.ts`
9. `src/core/protect/RooProtectedController.ts`
10. `src/core/prompts/tools/filter-tools-for-mode.ts`
11. `src/core/tools/validateToolUse.ts`

### Access Control / Restriction Systems (4)

12. `src/shared/modes.ts`
13. `src/core/webview/generateSystemPrompt.ts`
14. `src/services/rules/__tests__/rules.spec.ts`
15. `WORKSPACE_GOVERNANCE.md`

### UI Safety Messages — chat.json (18 files)

16. `webview-ui/src/i18n/locales/ca/chat.json`
17. `webview-ui/src/i18n/locales/de/chat.json`
18. `webview-ui/src/i18n/locales/en/chat.json`
19. `webview-ui/src/i18n/locales/es/chat.json`
20. `webview-ui/src/i18n/locales/fr/chat.json`
21. `webview-ui/src/i18n/locales/hi/chat.json`
22. `webview-ui/src/i18n/locales/id/chat.json`
23. `webview-ui/src/i18n/locales/it/chat.json`
24. `webview-ui/src/i18n/locales/ja/chat.json`
25. `webview-ui/src/i18n/locales/ko/chat.json`
26. `webview-ui/src/i18n/locales/nl/chat.json`
27. `webview-ui/src/i18n/locales/pl/chat.json`
28. `webview-ui/src/i18n/locales/pt-BR/chat.json`
29. `webview-ui/src/i18n/locales/ru/chat.json`
30. `webview-ui/src/i18n/locales/tr/chat.json`
31. `webview-ui/src/i18n/locales/vi/chat.json`
32. `webview-ui/src/i18n/locales/zh-CN/chat.json`
33. `webview-ui/src/i18n/locales/zh-TW/chat.json`

### UI Safety Messages — settings.json (18 files)

34. `webview-ui/src/i18n/locales/ca/settings.json`
35. `webview-ui/src/i18n/locales/de/settings.json`
36. `webview-ui/src/i18n/locales/en/settings.json`
37. `webview-ui/src/i18n/locales/es/settings.json`
38. `webview-ui/src/i18n/locales/fr/settings.json`
39. `webview-ui/src/i18n/locales/hi/settings.json`
40. `webview-ui/src/i18n/locales/id/settings.json`
41. `webview-ui/src/i18n/locales/it/settings.json`
42. `webview-ui/src/i18n/locales/ja/settings.json`
43. `webview-ui/src/i18n/locales/ko/settings.json`
44. `webview-ui/src/i18n/locales/nl/settings.json`
45. `webview-ui/src/i18n/locales/pl/settings.json`
46. `webview-ui/src/i18n/locales/pt-BR/settings.json`
47. `webview-ui/src/i18n/locales/ru/settings.json`
48. `webview-ui/src/i18n/locales/tr/settings.json`
49. `webview-ui/src/i18n/locales/vi/settings.json`
50. `webview-ui/src/i18n/locales/zh-CN/settings.json`
51. `webview-ui/src/i18n/locales/zh-TW/settings.json`

### Governance (2)

52. `CODE_OF_CONDUCT.md`
53. `AGENTS.md`

### Security Tests (5)

54. `src/core/config/__tests__/CustomModesManager.spec.ts`
55. `src/utils/__tests__/shell.spec.ts`
56. `src/integrations/terminal/__tests__/TerminalProfile.spec.ts`
57. `src/services/code-index/semble/__tests__/semble-downloader.spec.ts`
58. `src/core/prompts/sections/__tests__/custom-instructions.spec.ts`

---

_End of audit report._
