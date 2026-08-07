# 🏛️ Zoo Code — Architecture Reference

> Deep technical architecture of the Zoo Code VS Code extension.
> Read this before modifying any module.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                    │
│                                                             │
│  extension.ts (activate)                                    │
│       │                                                     │
│       ├── ClineProvider (WebviewProvider)                   │
│       │       └── React Webview UI (webview-ui/)           │
│       │               ↕ postMessage IPC                    │
│       ├── Task Engine (src/core/task/)                      │
│       │       ├── AI Provider (src/api/providers/)          │
│       │       ├── Tool Executor (src/core/tools/)           │
│       │       ├── Context Manager (src/core/context/)       │
│       │       └── Prompt Builder (src/core/prompts/)        │
│       ├── Services                                          │
│       │       ├── MCP Server Manager                        │
│       │       ├── Code Index Manager (tree-sitter)          │
│       │       └── Zoo Code Auth                             │
│       └── Integrations                                      │
│               ├── Terminal (shell execution)                │
│               ├── Editor (diff view, decorations)           │
│               └── Browser (Playwright)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Monorepo Packages (Build Order Matters)

```
@roo-code/types          ← FIRST (all packages depend on this)
@roo-code/ipc            ← message contracts
@roo-code/core           ← shared AI engine
@roo-code/cloud          ← cloud auth/sync
@roo-code/telemetry      ← analytics
config-eslint            ← shared lint config
config-typescript        ← shared TS config
src (extension)          ← LAST (depends on all above)
webview-ui               ← parallel with extension
```

---

## Core Data Flow — Task Execution

```
User types message in webview
        │
        ↓ postMessage("newTask" | "sendMessage")
ClineProvider.postMessageToWebview()
        │
        ↓
Task.initiateTaskLoop()
        │
        ├── buildApiRequestMessages()   ← assembles conversation history
        │       └── PromptBuilder       ← system prompt + tool definitions
        │
        ├── ApiProvider.createMessage() ← streams from AI model
        │
        ├── parseAssistantMessage()     ← extracts text + tool_use blocks
        │
        └── executeTool(tool_use)       ← runs the requested tool
                ├── read_file
                ├── write_to_file
                ├── execute_command     → Terminal integration
                ├── browser_action     → Playwright
                ├── use_mcp_tool       → MCP Server
                ├── search_files       → ripgrep
                └── ... 40+ more tools
```

---

## Key Classes & Their Responsibilities

### `ClineProvider` (`src/core/webview/ClineProvider.ts`)
- Main WebviewViewProvider registered with VS Code
- Manages the React webview lifecycle
- Routes IPC messages between webview ↔ extension
- Owns the Task instance lifecycle
- Manages workspace state persistence

### `Task` (`src/core/task/Task.ts`)
- Central orchestrator for one AI conversation session
- Manages: conversation history, tool execution, streaming, checkpoints
- Emits events for UI updates
- Handles recursion (tools can trigger sub-tasks)

### `ContextProxy` (`src/core/config/ContextProxy.ts`)
- Single source of truth for all extension settings
- Wraps VS Code's globalState + workspaceState
- All settings reads/writes go through this

### `McpServerManager` (`src/services/mcp/McpServerManager.ts`)
- Manages lifecycle of all MCP server connections
- Supports stdio and SSE transport
- Tool discovery and routing

### `CodeIndexManager` (`src/services/code-index/manager.ts`)
- Per-workspace semantic code indexing
- Uses tree-sitter for AST parsing
- Stores embeddings for semantic search
- One instance per VS Code workspace folder

---

## IPC Message Protocol (Extension ↔ Webview)

All messages typed in `packages/ipc/`. Pattern:

```typescript
// Extension → Webview
vscode.postMessage({ type: "state", state: ExtensionState })

// Webview → Extension  
vscode.postMessage({ type: "newTask", text: "...", images: [] })
vscode.postMessage({ type: "apiConfiguration", ... })
```

**CRITICAL:** Never add raw untyped postMessage calls.
Always add the type to `@roo-code/ipc` first.

---

## AI Provider Interface

All providers implement `ApiHandler` from `src/api/index.ts`:

```typescript
interface ApiHandler {
  createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream
  getModel(): { id: string; info: ModelInfo }
}
```

Adding a new provider:
1. Create `src/api/providers/<name>.ts` implementing `ApiHandler`
2. Add to `src/api/index.ts` factory
3. Add model list to `src/shared/api.ts`
4. Add to `packages/types/src/` shared types
5. Add UI controls in `webview-ui/src/components/settings/`
6. Write unit tests in `src/api/providers/__tests__/`

---

## State Management

```
Extension State (source of truth)
    └── ContextProxy (globalState + workspaceState)
            │
            ↓ on change → postMessage("state", fullState)
    Webview State
            └── ExtensionStateContext (React Context)
                    └── useExtensionState() hook
```

**CRITICAL (from AGENTS.md):**
SettingsView inputs bind to `cachedState`, NOT live `useExtensionState()`.
The cached state is flushed only on explicit "Save" click.
Direct binding to live state causes race conditions.

---

## Test Architecture

```
Unit tests        → src/**/__tests__/*.spec.ts     (Vitest, fast)
Webview tests     → webview-ui/src/**/*.spec.ts    (Vitest + jsdom)
Integration tests → packages/*/src/**/*.spec.ts    (Vitest)
E2E tests         → apps/vscode-e2e/               (Playwright + VS Code)
```

Test pyramid: Most coverage at unit level. E2E only for critical workflows.

---

## Bundle Output

```
dist/
  extension.js          ← Single bundled extension (esbuild)
  extension.js.map      ← Source map
webview-ui/build/
  assets/               ← Vite-bundled React app
```

The `.vsix` file packages both into a single installable extension.

---

## Critical Constraints

1. **Node.js 20.20.2** — exact version, managed by `.nvmrc` and `.tool-versions`
2. **pnpm 10.8.1** — exact version, enforced by `only-allow`
3. **`@roo-code/types` must build first** — all other packages import from it
4. **SettingsView state isolation** — see AGENTS.md, critical pattern
5. **No `.changeset` files per-commit** — managed by maintainers only
6. **Zod 3.25.76** — pinned via pnpm overrides (security)
7. **Tree-sitter queries** — each language has its own query file, test before adding

---

*Last updated: 2026-06-24*
