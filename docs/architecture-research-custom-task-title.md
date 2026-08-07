# Architecture Research: Custom Chat/Task Title Feature

> **Status:** Research deliverable — no implementation proposed yet.
> **Date:** 2026-06-30
> **Scope:** Read-only investigation of existing task/history architecture to inform a future custom title feature.

---

## 1. Understanding of the Existing Architecture

### 1.1 Core Data Model

The central data structure is `HistoryItem`, defined in [`packages/types/src/history.ts`](Zoo-Code/packages/types/src/history.ts:7) using a Zod schema:

```ts
export const historyItemSchema = z.object({
	id: z.string(),
	rootTaskId: z.string().optional(),
	parentTaskId: z.string().optional(),
	number: z.number(),
	ts: z.number(),
	task: z.string(), // ← Current title field
	tokensIn: z.number(),
	tokensOut: z.number(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
	totalCost: z.number(),
	size: z.number().optional(),
	workspace: z.string().optional(),
	mode: z.string().optional(),
	apiConfigName: z.string().optional(),
	status: z.enum(["active", "completed", "delegated"]).optional(),
	delegatedToId: z.string().optional(),
	childIds: z.array(z.string()).optional(),
	awaitingChildId: z.string().optional(),
	completedByChildId: z.string().optional(),
	completionResultSummary: z.string().optional(),
})
```

The `task` field serves dual duty as both the title and the first user message text. There is no separate `title` or `customTitle` field.

### 1.2 Persistence Layer

[`TaskHistoryStore`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:44) owns all history persistence:

- **Per-task file:** `globalStorage/tasks/<taskId>/history_item.json` — source of truth
- **Index cache:** `globalStorage/tasks/_index.json` — debounced, secondary
- **In-memory cache:** `Map<string, HistoryItem>` — loaded from per-task files on init
- **Merge semantics in [`_upsertUnlocked()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:168):**
    ```ts
    const existing = this.cache.get(item.id)
    const merged = existing ? { ...existing, ...item } : item
    ```
    This spread-based merge means any field present on `existing` but absent from `item` is **preserved**. This is a critical property for custom title storage.

### 1.3 Title Derivation

[`taskMetadata()`](Zoo-Code/src/core/task-persistence/taskMetadata.ts:30) is the sole function that sets `HistoryItem.task`:

```ts
task: hasMessages
  ? taskMessage!.text?.trim() || t("common:tasks.incomplete", { taskNumber })
  : t("common:tasks.no_messages", { taskNumber }),
```

It always builds a **fresh** `HistoryItem` object — it never reads the existing stored item. This means:

- It **always overwrites** the `task` field with the first message text
- It does **not** include any field it doesn't explicitly set (e.g., a hypothetical `customTitle` field would be absent from the returned object)

### 1.4 Save Pipeline

[`Task.saveClineMessages()`](Zoo-Code/src/core/task/Task.ts:1063) is the critical call path:

```
saveClineMessages()
  → saveTaskMessages()         // writes ui_messages.json
  → taskMetadata()             // builds fresh HistoryItem (overwrites `task`)
  → provider.updateTaskHistory(historyItem)  // upserts into store
    → taskHistoryStore.upsert(item)          // merge: { ...existing, ...item }
    → postMessageToWebview({ type: "taskHistoryItemUpdated", ... })
```

**Key insight:** Because `taskMetadata()` returns an object **without** a hypothetical `customTitle` field, the spread merge in `_upsertUnlocked()` would **preserve** any previously stored `customTitle` from the existing item.

### 1.5 Extension ↔ Webview Synchronization

Defined in [`packages/types/src/vscode-extension-host.ts`](Zoo-Code/packages/types/src/vscode-extension-host.ts:26):

- **Extension → Webview messages:** `"state"`, `"taskHistoryUpdated"`, `"taskHistoryItemUpdated"`
- **Webview → Extension messages:** `"newTask"`, `"showTaskWithId"`, `"deleteTaskWithId"`, `"deleteMultipleTasksWithIds"`, `"exportTaskWithId"`, `"importRooHistory"`
- **No `"renameTask"` message exists yet.**

[`ExtensionState`](Zoo-Code/packages/types/src/vscode-extension-host.ts:259) includes:

```ts
taskHistory: HistoryItem[]
currentTaskId?: string
currentTaskItem?: HistoryItem
clineMessages: ClineMessage[]
```

The webview context ([`ExtensionStateContext.tsx`](Zoo-Code/webview-ui/src/context/ExtensionStateContext.tsx:478)) handles `taskHistoryItemUpdated` by upserting the single item and re-sorting by timestamp.

### 1.6 History Sidebar UI

- **[`HistoryView.tsx`](Zoo-Code/webview-ui/src/components/history/HistoryView.tsx)** — main history panel with search, sort, grouping
- **[`TaskItem.tsx`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx:24)** — renders `item.task` with highlight support, click → `showTaskWithId`
- **[`TaskItemFooter.tsx`](Zoo-Code/webview-ui/src/components/history/TaskItemFooter.tsx:19)** — time ago, cost, copy/export/delete buttons (visible on hover)
- **[`SubtaskRow.tsx`](Zoo-Code/webview-ui/src/components/history/SubtaskRow.tsx:26)** — renders subtask with `item.task` in tooltip
- **[`TaskGroupItem.tsx`](Zoo-Code/webview-ui/src/components/history/TaskGroupItem.tsx:36)** — parent + collapsible subtask tree

### 1.7 Search & Filtering

[`useTaskSearch.ts`](Zoo-Code/webview-ui/src/components/history/useTaskSearch.ts:9):

```ts
const fzf = useMemo(() => {
	return new Fzf(presentableTasks, {
		selector: (item) => item.task, // Searches ONLY by task field
	})
}, [presentableTasks])
```

- Filters by `item.ts && item.task` (requires both)
- Filters by workspace by default
- Sort options: newest, oldest, mostExpensive, mostTokens, mostRelevant
- Auto-switches to `mostRelevant` when searching

### 1.8 Grouping

[`useGroupedTasks.ts`](Zoo-Code/webview-ui/src/components/history/useGroupedTasks.ts:36) groups by `parentTaskId`. Root tasks = no parent or parent missing. Search mode returns flat list with `isSubtask` flag.

### 1.9 Export/Import

- **Export** ([`export-markdown.ts`](Zoo-Code/src/integrations/misc/export-markdown.ts:36)): Exports API conversation history as markdown. Does **NOT** include `HistoryItem` metadata.
- **Import** ([`importRooTaskHistory.ts`](Zoo-Code/src/core/task-persistence/importRooTaskHistory.ts:92)): Validates with `historyItemSchema.safeParse()`, then copies the raw `history_item.json` file directly. The Zod parse is validation-only; it does **not** transform or strip the copied file.

### 1.10 Existing Rename Patterns

Two inline rename patterns already exist in the codebase:

1. **[`ApiConfigManager.tsx`](Zoo-Code/webview-ui/src/components/settings/ApiConfigManager.tsx)** — edit icon → inline input → save/cancel buttons for provider profiles
2. **[`ModesView.tsx`](Zoo-Code/webview-ui/src/components/modes/ModesView.tsx)** — inline rename for custom modes with optimistic updates, uses `isRenamingMode`, `renameInputValue`, `renameInputRef` state

Both use a consistent pattern: pencil/edit icon → inline text input → checkmark save + X cancel buttons.

A [`DropdownMenu`](Zoo-Code/webview-ui/src/components/ui/dropdown-menu.tsx) component from Radix UI is also available.

---

## 2. Current Data Flow

### 2.1 Task Creation Flow

```
User types prompt → webview sends { type: "newTask", text }
  → webviewMessageHandler.ts handles "newTask"
    → provider.createTask(text)
      → new Task({ ..., taskInstructions: text })
        → Task.start()
          → startTask(task)
            → say(text)                    // First UI message
            → initiateTaskLoop()
              → saveClineMessages()        // First history save
                → taskMetadata()           // HistoryItem.task = text
                → provider.updateTaskHistory(item)
                  → taskHistoryStore.upsert(item)
                  → webview receives "taskHistoryItemUpdated"
```

### 2.2 Active Task Save Flow (Every Message)

```
Task makes progress (AI response, tool use, etc.)
  → addToClineMessages() or updateClineMessage()
    → saveClineMessages()
      → saveTaskMessages()                // Persists UI messages
      → taskMetadata()                    // Rebuilds HistoryItem from scratch
        → HistoryItem.task = firstMessage.text  // OVERWRITES title every time
      → provider.updateTaskHistory(item)
        → taskHistoryStore.upsert(item)   // Merge preserves fields not in `item`
        → webview receives "taskHistoryItemUpdated"
```

### 2.3 Task Resume Flow

```
User clicks history item → webview sends { type: "showTaskWithId", text: taskId }
  → provider.showTaskWithId(id)
    → getTaskWithId(id)                   // Loads history_item.json + ui_messages.json
    → provider.createTaskWithHistoryItem(historyItem)
      → Restores mode, apiConfigName
      → new Task({ ..., historyItem })
        → Task.resumeTaskFromHistory()
          → Loads saved ClineMessages
          → saveClineMessages()           // Rebuilds metadata (OVERWRITES task again)
```

### 2.4 Task Switch Flow

```
New task created while old task active
  → Old task: saveClineMessages()         // Final save, rebuilds metadata
  → Old task removed from stack
  → New task created on stack
  → Webview receives fresh state via getStateToPostToWebview()
```

### 2.5 State Broadcast Flow

```
ClineProvider.updateTaskHistory(item)
  → taskHistoryStore.upsert(item)         // Persist to disk + cache
  → postMessageToWebview({
      type: "taskHistoryItemUpdated",
      taskHistoryItem: updatedItem         // Single item, not full history
    })
  → ExtensionStateContext receives message
    → Upserts item into taskHistory array
    → Re-sorts by timestamp
    → Updates currentTaskItem if matching
```

---

## 3. Current Ownership of Task Metadata

| Aspect            | Owner                               | Location                                             |
| ----------------- | ----------------------------------- | ---------------------------------------------------- |
| Schema definition | `@roo-code/types`                   | `packages/types/src/history.ts`                      |
| Title derivation  | `taskMetadata()`                    | `src/core/task-persistence/taskMetadata.ts`          |
| Persistence       | `TaskHistoryStore`                  | `src/core/task-persistence/TaskHistoryStore.ts`      |
| Save trigger      | `Task.saveClineMessages()`          | `src/core/task/Task.ts:1063`                         |
| Broadcast         | `ClineProvider.updateTaskHistory()` | `src/core/webview/ClineProvider.ts:2733`             |
| Display           | `TaskItem`, `SubtaskRow`            | `webview-ui/src/components/history/`                 |
| Search index      | `useTaskSearch` (Fzf)               | `webview-ui/src/components/history/useTaskSearch.ts` |
| Import validation | `importRooTaskHistory`              | `src/core/task-persistence/importRooTaskHistory.ts`  |
| Export            | `downloadTask()`                    | `src/integrations/misc/export-markdown.ts`           |

**Critical ownership chain:** `taskMetadata()` owns the `task` field. It is called from `saveClineMessages()` which runs on **every** message save. Any value written to `HistoryItem.task` by anything other than `taskMetadata()` will be overwritten on the next message.

---

## 4. UX Analysis

### 4.1 Rename Action Placement

**Recommended: Context menu (right-click) + hover action button**

| Placement                         | Pros                                                                          | Cons                                           | Recommendation                                    |
| --------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Right-click context menu          | Standard pattern, discoverable, doesn't clutter UI                            | Requires right-click knowledge                 | ✅ Primary                                        |
| Hover action button (pencil icon) | Discoverable, matches existing copy/export/delete pattern in `TaskItemFooter` | Adds visual noise                              | ✅ Secondary                                      |
| Three-dot menu                    | Familiar mobile pattern, extensible                                           | Overkill for single action, adds click         | ⚠️ Consider if more actions added later           |
| Double-click on title             | Fast for power users                                                          | Not discoverable, conflicts with click-to-open | ❌ Conflicts with existing `showTaskWithId` click |
| F2 keyboard shortcut              | Power user efficiency                                                         | Not discoverable, requires focus management    | ⚠️ Phase 2 enhancement                            |
| Inline rename on hover            | Reduces clicks                                                                | Can be accidentally triggered, jarring         | ❌ Too aggressive                                 |

**Recommended implementation pattern (matches existing codebase):**

1. Add a pencil/edit icon button to [`TaskItemFooter.tsx`](Zoo-Code/webview-ui/src/components/history/TaskItemFooter.tsx:19), visible on hover alongside copy/export/delete
2. Click activates inline rename mode (input replaces title text)
3. Enter/blur saves, Escape cancels
4. Follow the same pattern as [`ApiConfigManager.tsx`](Zoo-Code/webview-ui/src/components/settings/ApiConfigManager.tsx) and [`ModesView.tsx`](Zoo-Code/webview-ui/src/components/modes/ModesView.tsx)

### 4.2 Rename Behavior Details

| Scenario          | Recommended Behavior                                              |
| ----------------- | ----------------------------------------------------------------- |
| Empty name        | Reject. Show validation error. Minimum 1 character after trim.    |
| Duplicate names   | Allow. Users may have multiple tasks with the same topic.         |
| Cancel (Escape)   | Revert to original title. No persistence.                         |
| Save (Enter/blur) | Persist to `customTitle` field. Broadcast to webview.             |
| Whitespace-only   | Reject. Treat as empty.                                           |
| Very long names   | Allow. CSS `text-overflow: ellipsis` in UI. Full name in tooltip. |
| Emoji in names    | Allow. No restrictions.                                           |
| RTL text          | Allow. CSS `direction: auto` handles this.                        |
| Multi-line        | Reject. Single-line only. Input field, not textarea.              |
| Undo              | Not needed for v1. User can re-edit.                              |

### 4.3 Display Behavior

When a custom title exists:

- **History sidebar:** Show `customTitle` instead of derived `task`
- **Search:** Search should match against both `customTitle` and `task` (the original message)
- **Tooltip:** Show original `task` text in tooltip when hovering over a custom title (so users can see the original prompt)
- **Export:** Include `customTitle` in exported markdown header if present
- **Subtask display:** Same treatment — `customTitle` overrides `task` display

### 4.4 Localization

All new UI strings (button labels, placeholders, validation messages) must go through the existing `i18n` system (`t("key")`). Add keys to `en/history.json` and update other locale files.

---

## 5. Edge Cases

### 5.1 Title Overwrite During Active Task

**Risk:** `saveClineMessages()` calls `taskMetadata()` which rebuilds `HistoryItem` from scratch. The `task` field is always overwritten.

**Mitigation:** Store custom title in a **separate field** (`customTitle`). Since `taskMetadata()` doesn't include `customTitle` in its output, the spread merge `{ ...existing, ...item }` in `_upsertUnlocked()` preserves it.

### 5.2 Title Persistence During Task Resume

**Risk:** When a task is resumed, `resumeTaskFromHistory()` eventually calls `saveClineMessages()`, which rebuilds metadata.

**Mitigation:** Same as 5.1 — `customTitle` survives because it's not in the rebuilt object.

### 5.3 Concurrent Access

**Risk:** Multiple VS Code windows could modify the same task's title simultaneously.

**Mitigation:** `TaskHistoryStore` already has a lock mechanism (`withLock()`). The rename operation should go through `upsert()` or `atomicReadAndUpdate()`.

### 5.4 Import with Custom Title

**Risk:** Import uses `historyItemSchema.safeParse()` for validation. Zod's `z.object()` **strips unknown fields** by default. If `customTitle` is not in the schema, it would be stripped from the validation result.

**Mitigation:** Two options:

1. Add `customTitle` to `historyItemSchema` — **recommended**, makes it official
2. Note that import actually copies the raw JSON file, not the parsed result — so unknown fields survive in the file even if stripped from the parse result. But this is fragile.

### 5.5 Export Behavior

**Risk:** Current export only includes API conversation history as markdown. `customTitle` is in `HistoryItem`, not in the conversation.

**Mitigation:** Add `customTitle` to the markdown header if present.

### 5.6 Search Behavior

**Risk:** Fzf search currently only searches `item.task`. If user renames a task, searching by original content wouldn't find it.

**Mitigation:** Search should match against both `customTitle` and `task`:

```ts
selector: (item) => (item.customTitle ? `${item.customTitle} ${item.task}` : item.task)
```

### 5.7 Migration for Existing Tasks

**Risk:** Existing tasks don't have `customTitle` field. Need to handle gracefully.

**Mitigation:** `customTitle` is optional (`z.string().optional()`). All display logic uses `item.customTitle || item.task`. No migration needed.

### 5.8 Task Deletion

**Risk:** None. `customTitle` lives inside `history_item.json`. Deleting the task deletes everything.

### 5.9 Subtask Renaming

**Risk:** Subtasks use the same `HistoryItem` schema. Should subtasks be renamable?

**Mitigation:** Yes, using the same mechanism. `SubtaskRow.tsx` already renders `item.task`.

### 5.10 Race Between Rename and Active Save

**Risk:** User renames task while the AI is actively writing messages. Both operations call `upsert()`.

**Mitigation:** The rename sets `customTitle` on the stored item. The active save's `taskMetadata()` returns an object without `customTitle`. The merge `{ ...existing, ...item }` preserves `customTitle`. No race condition.

**However**, there's a subtle timing issue: if rename reads, modifies, and writes while `saveClineMessages` is also reading and writing, the lock in `withLock()` serializes them. The merge semantics ensure correctness regardless of order.

---

## 6. Risks

### 6.1 Schema Compatibility (Medium Risk)

Adding `customTitle` to `historyItemSchema` changes the type signature of `HistoryItem`. All code that constructs `HistoryItem` objects (including `taskMetadata()`, tests, mocks) needs to handle the new optional field. Since it's optional, existing code that doesn't set it is fine — Zod will default to `undefined`.

### 6.2 Zod Stripping Unknown Fields (Medium Risk)

If `customTitle` is added to the schema, it becomes an official field. If it's NOT added, Zod's default `z.object()` behavior strips it during `safeParse()`. The import validation uses `safeParse()` — if the field is stripped, the validation passes but the field is lost from the parsed result. However, import copies the raw file, so this is only a risk for the validation logic, not the actual data transfer. Still, adding it to the schema is cleaner.

### 6.3 Webview State Consistency (Low Risk)

The webview receives `taskHistoryItemUpdated` messages with the full `HistoryItem` object. Adding `customTitle` to the type means the webview automatically receives it. No special handling needed in `ExtensionStateContext.tsx` beyond what already exists.

### 6.4 Performance (Negligible Risk)

Adding one optional string field to `HistoryItem` has no measurable performance impact. The per-task JSON files are small (< 1KB typically). The in-memory cache handles thousands of items easily.

### 6.5 Backward Compatibility (Low Risk)

Older versions of the extension that don't know about `customTitle` will simply ignore the field when reading `history_item.json`. Zod's `safeParse()` strips unknown fields, so no errors. The field is optional, so older TypeScript types are compatible.

### 6.6 AI Overwriting Custom Titles (No Risk — with correct design)

This is the **most critical risk** and the reason for the separate field approach. If `customTitle` were stored in the `task` field, every `saveClineMessages()` call would overwrite it. Using a separate field completely eliminates this risk.

---

## 7. Architectural Recommendations

### 7.1 Recommended Data Model Change

Add `customTitle` as an optional field to `historyItemSchema`:

```ts
export const historyItemSchema = z.object({
	// ... existing fields ...
	task: z.string(),
	customTitle: z.string().optional(), // ← New field
	// ... rest of existing fields ...
})
```

**Why a separate field, not overloading `task`:**

- `taskMetadata()` always overwrites `task` — protecting it would require modifying the core save pipeline
- `task` serves as the canonical "first message text" and is used for fallback display
- `customTitle` is purely presentational — it overrides display but doesn't change the underlying data
- Search can match against both fields
- Export can include both

### 7.2 Recommended Persistence Strategy

**No changes to `taskMetadata()` or `saveClineMessages()`.** The existing merge semantics in `_upsertUnlocked()` naturally preserve `customTitle`:

```ts
// In _upsertUnlocked:
const merged = existing ? { ...existing, ...item } : item
// If `item` (from taskMetadata) doesn't have customTitle,
// it's preserved from `existing`.
```

**New rename method on `ClineProvider`:**

```ts
async renameTask(taskId: string, customTitle: string): Promise<void> {
  await this.taskHistoryStore.atomicReadAndUpdate(taskId, (current) => ({
    ...current,
    customTitle: customTitle.trim() || undefined,
  }))
  // Broadcast handled by updateTaskHistory
}
```

### 7.3 Recommended Message Protocol

Add to `WebviewMessage.type`:

```ts
| "renameTask"
```

Add to `WebviewMessage`:

```ts
customTitle?: string  // For renameTask
```

Handler in `webviewMessageHandler.ts`:

```ts
case "renameTask": {
  if (message.taskId && message.text !== undefined) {
    await provider.renameTask(message.taskId, message.text)
  }
  break
}
```

### 7.4 Recommended Display Logic

Create a utility function:

```ts
function getDisplayTitle(item: HistoryItem): string {
	return item.customTitle || item.task
}
```

Use in `TaskItem.tsx`, `SubtaskRow.tsx`, `HistoryPreview.tsx`.

### 7.5 Recommended Search Enhancement

Update `useTaskSearch.ts`:

```ts
const fzf = useMemo(() => {
	return new Fzf(presentableTasks, {
		selector: (item) => (item.customTitle ? `${item.customTitle} ${item.task}` : item.task),
	})
}, [presentableTasks])
```

### 7.6 Recommended UI Implementation

Follow the existing pattern from `ModesView.tsx`:

1. Add pencil icon button to `TaskItemFooter.tsx` (hover-visible)
2. On click: set `renamingTaskId` state in `HistoryView.tsx`
3. `TaskItem` checks if `item.id === renamingTaskId` → renders inline input instead of title
4. Enter/blur → `vscode.postMessage({ type: "renameTask", taskId: item.id, text: inputValue })`
5. Escape → cancel rename, revert display
6. Optimistic update: immediately show new title in UI, let server broadcast confirm

### 7.7 Recommended Export Enhancement

In `export-markdown.ts`, add to the markdown header:

```ts
if (historyItem?.customTitle) {
	markdown += `**Custom Title:** ${historyItem.customTitle}\n\n`
}
```

### 7.8 Recommended Import Handling

Add `customTitle` to `historyItemSchema`. This automatically handles:

- Import validation (field is recognized)
- Type safety (TypeScript knows about it)
- Backward compatibility (optional field, old data without it is valid)

### 7.9 Implementation Order

1. **Schema change** — add `customTitle` to `historyItemSchema` in `packages/types/src/history.ts`
2. **Extension handler** — add `"renameTask"` to `WebviewMessage`, implement handler in `webviewMessageHandler.ts`, add `renameTask()` to `ClineProvider`
3. **Display utility** — create `getDisplayTitle()`, update `TaskItem`, `SubtaskRow`, `HistoryPreview`
4. **Search update** — update Fzf selector in `useTaskSearch.ts`
5. **UI** — add rename button to `TaskItemFooter`, inline rename state in `HistoryView`
6. **Export** — add custom title to markdown export
7. **Tests** — unit tests for rename persistence, merge behavior, search, display
8. **i18n** — add localization keys for rename UI

---

## Appendix: Key File Reference

| File                                                                                                                          | Role                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`packages/types/src/history.ts`](Zoo-Code/packages/types/src/history.ts)                                                     | `HistoryItem` schema and type                                          |
| [`packages/types/src/vscode-extension-host.ts`](Zoo-Code/packages/types/src/vscode-extension-host.ts)                         | Message types (`ExtensionMessage`, `WebviewMessage`, `ExtensionState`) |
| [`src/core/task-persistence/taskMetadata.ts`](Zoo-Code/src/core/task-persistence/taskMetadata.ts)                             | Title derivation from first message                                    |
| [`src/core/task-persistence/TaskHistoryStore.ts`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts)                     | Persistence layer with merge semantics                                 |
| [`src/core/task/Task.ts`](Zoo-Code/src/core/task/Task.ts)                                                                     | `saveClineMessages()` — triggers metadata rebuild                      |
| [`src/core/webview/ClineProvider.ts`](Zoo-Code/src/core/webview/ClineProvider.ts)                                             | `updateTaskHistory()`, `createTaskWithHistoryItem()`                   |
| [`src/core/webview/webviewMessageHandler.ts`](Zoo-Code/src/core/webview/webviewMessageHandler.ts)                             | Webview message dispatch                                               |
| [`webview-ui/src/context/ExtensionStateContext.tsx`](Zoo-Code/webview-ui/src/context/ExtensionStateContext.tsx)               | Webview state management                                               |
| [`webview-ui/src/components/history/TaskItem.tsx`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx)                   | Task display in history sidebar                                        |
| [`webview-ui/src/components/history/TaskItemFooter.tsx`](Zoo-Code/webview-ui/src/components/history/TaskItemFooter.tsx)       | Hover action buttons                                                   |
| [`webview-ui/src/components/history/useTaskSearch.ts`](Zoo-Code/webview-ui/src/components/history/useTaskSearch.ts)           | Fuzzy search                                                           |
| [`webview-ui/src/components/history/useGroupedTasks.ts`](Zoo-Code/webview-ui/src/components/history/useGroupedTasks.ts)       | Parent-child grouping                                                  |
| [`src/integrations/misc/export-markdown.ts`](Zoo-Code/src/integrations/misc/export-markdown.ts)                               | Export logic                                                           |
| [`src/core/task-persistence/importRooTaskHistory.ts`](Zoo-Code/src/core/task-persistence/importRooTaskHistory.ts)             | Import validation                                                      |
| [`webview-ui/src/components/settings/ApiConfigManager.tsx`](Zoo-Code/webview-ui/src/components/settings/ApiConfigManager.tsx) | Existing rename pattern (provider profiles)                            |
| [`webview-ui/src/components/modes/ModesView.tsx`](Zoo-Code/webview-ui/src/components/modes/ModesView.tsx)                     | Existing rename pattern (custom modes)                                 |
