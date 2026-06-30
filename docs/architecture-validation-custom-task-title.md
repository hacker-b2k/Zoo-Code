# Architecture Validation: Custom Chat/Task Title

> **Status:** Lead-architect validation deliverable — documentation only.
> **Date:** 2026-06-30
> **Scope:** Validate the proposed custom task title architecture against the current codebase. No implementation code is included.

---

## Executive Decision

I would approve this architecture for production **with two required design constraints**:

1. Store the user-editable name in a separate optional field, represented here as [`customTitle`](Zoo-Code/packages/types/src/history.ts:7), and never mutate the canonical original prompt field [`task`](Zoo-Code/packages/types/src/history.ts:13).
2. Route all rename writes through the existing per-task history store using [`TaskHistoryStore.atomicReadAndUpdate()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:550), not through ad hoc file writes or direct webview state updates.

This is the correct long-term architecture because [`taskMetadata()`](Zoo-Code/src/core/task-persistence/taskMetadata.ts:30) reconstructs [`HistoryItem`](Zoo-Code/packages/types/src/history.ts:31) metadata from messages and rewrites [`task`](Zoo-Code/packages/types/src/history.ts:13) on every save. Any design that writes the custom title into [`task`](Zoo-Code/packages/types/src/history.ts:13) will eventually lose data.

---

## 1. State Ownership

### Verdict

There should be exactly one authoritative persisted value for the custom user title: [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) on the per-task [`HistoryItem`](Zoo-Code/packages/types/src/history.ts:31) stored by [`TaskHistoryStore`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:44).

### Evidence

- The current schema defines [`task`](Zoo-Code/packages/types/src/history.ts:13) as the required title/original-prompt field on [`HistoryItem`](Zoo-Code/packages/types/src/history.ts:31).
- The persistence owner is [`TaskHistoryStore`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:44), which writes the authoritative per-task file in [`TaskHistoryStore._upsertUnlocked()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:168).
- The write path preserves unknown or absent fields through merge semantics in [`TaskHistoryStore._upsertUnlocked()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:168): existing item fields survive unless the incoming item explicitly overwrites them.
- Webview state is derived state. [`ExtensionStateContext`](Zoo-Code/webview-ui/src/context/ExtensionStateContext.tsx:478) receives [`taskHistoryItemUpdated`](Zoo-Code/packages/types/src/vscode-extension-host.ts:26) and replaces the in-memory item, but it is not the source of truth.

### Ownership Rules

| Data                                                                   | Owner                                                                                                                                  |   Mutability | Purpose                                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -----------: | ----------------------------------------------- |
| Original prompt [`task`](Zoo-Code/packages/types/src/history.ts:13)    | [`taskMetadata()`](Zoo-Code/src/core/task-persistence/taskMetadata.ts:30)                                                              | System-owned | Stable semantic record of the first user prompt |
| Custom title [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) | Rename command handler via [`TaskHistoryStore.atomicReadAndUpdate()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:550)      |   User-owned | Display/search alias                            |
| Display title                                                          | UI helper resolving [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) then [`task`](Zoo-Code/packages/types/src/history.ts:13) |      Derived | Presentation only                               |
| Search index text                                                      | [`useTaskSearch()`](Zoo-Code/webview-ui/src/components/history/useTaskSearch.ts:9)                                                     |      Derived | Fuzzy matching only                             |

### Why exactly one authoritative value

[`customTitle`](Zoo-Code/packages/types/src/history.ts:7) should exist only inside [`HistoryItem`](Zoo-Code/packages/types/src/history.ts:31). It should not be duplicated in [`ClineMessage`](Zoo-Code/packages/types/src/vscode-extension-host.ts:259), API conversation history, webview local state, global settings, or task metadata files. Every UI should derive display from the current [`HistoryItem`](Zoo-Code/packages/types/src/history.ts:31). This prevents drift between the active chat header, history list, search results, CLI history picker, and persisted task files.

---

## 2. Persistence Lifecycle

### Lifecycle Trace

| Stage             | Current flow                                                                                                                                                                                                                                               | Expected custom title behavior                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task created      | [`Task.startTask()`](Zoo-Code/src/core/task/Task.ts:1817) calls [`Task.say()`](Zoo-Code/src/core/task/Task.ts:1635) with initial text, then task messages are saved.                                                                                       | No [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) initially. Display falls back to [`task`](Zoo-Code/packages/types/src/history.ts:13).                                               |
| First AI response | [`Task.saveClineMessages()`](Zoo-Code/src/core/task/Task.ts:1063) calls [`taskMetadata()`](Zoo-Code/src/core/task-persistence/taskMetadata.ts:30), which sets [`task`](Zoo-Code/packages/types/src/history.ts:13) from the first message.                  | Still no [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) unless user already renamed. If renamed early, merge preserves it.                                                            |
| History updates   | [`ClineProvider.updateTaskHistory()`](Zoo-Code/src/core/webview/ClineProvider.ts:2733) calls store upsert and broadcasts [`taskHistoryItemUpdated`](Zoo-Code/packages/types/src/vscode-extension-host.ts:26).                                              | The broadcast item should include [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) if persisted.                                                                                        |
| Rename            | New webview message should be handled by [`webviewMessageHandler`](Zoo-Code/src/core/webview/webviewMessageHandler.ts:104), then persisted through [`TaskHistoryStore.atomicReadAndUpdate()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:550). | Sets or clears only [`customTitle`](Zoo-Code/packages/types/src/history.ts:7). Never modifies [`task`](Zoo-Code/packages/types/src/history.ts:13).                                               |
| More AI responses | [`Task.saveClineMessages()`](Zoo-Code/src/core/task/Task.ts:1063) runs repeatedly. [`taskMetadata()`](Zoo-Code/src/core/task-persistence/taskMetadata.ts:30) returns a fresh item without the custom field.                                                | [`TaskHistoryStore._upsertUnlocked()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:168) merges and preserves [`customTitle`](Zoo-Code/packages/types/src/history.ts:7).               |
| Resume task       | [`ClineProvider.createTaskWithHistoryItem()`](Zoo-Code/src/core/webview/ClineProvider.ts:980) constructs a task from a stored item. [`Task.resumeTaskFromHistory()`](Zoo-Code/src/core/task/Task.ts:1881) rewrites messages and saves again.               | Resume must keep [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) because save metadata does not explicitly overwrite it.                                                               |
| Switch task       | [`ClineProvider.showTaskWithId()`](Zoo-Code/src/core/webview/ClineProvider.ts:1942) loads the target task and state updates come from store-backed history.                                                                                                | UI should display the target task's [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) if present.                                                                                        |
| Export            | [`downloadTask()`](Zoo-Code/src/integrations/misc/export-markdown.ts:36) currently exports conversation messages only.                                                                                                                                     | Markdown export may optionally include display metadata, but must not replace message content. If included, use a header derived from [`customTitle`](Zoo-Code/packages/types/src/history.ts:7). |
| Import            | [`importRooTaskHistory()`](Zoo-Code/src/core/task-persistence/importRooTaskHistory.ts:231) validates [`history_item.json`](Zoo-Code/src/core/task-persistence/importRooTaskHistory.ts:92) and copies raw files.                                            | Add [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) to the schema so validation recognizes it. Raw copy currently preserves it, but relying on unknown-field preservation is fragile.  |
| Deletion          | [`TaskHistoryStore.delete()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:196) removes cache and task history file.                                                                                                                             | [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) disappears with the task. No separate cleanup needed.                                                                                  |

### Persistence Assessment

The lifecycle is sound if [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) is optional and stored on [`HistoryItem`](Zoo-Code/packages/types/src/history.ts:31). No migration is required for existing tasks because fallback display uses [`task`](Zoo-Code/packages/types/src/history.ts:13).

---

## 3. UI Ownership

### Rendering Inventory

| Location                                                                                                                  | Current title source                                                                                                                                                                                | Recommended title source                                                                                                                                                         | Reason                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| History row in [`TaskItem`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx:24)                                   | [`item.task`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx:96)                                                                                                                           | [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) fallback to [`task`](Zoo-Code/packages/types/src/history.ts:13)                                                        | Primary user-facing renamed task list.                                                                                                                                |
| History tooltip in [`TaskItem`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx:96)                               | [`item.task`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx:96)                                                                                                                           | Display title as tooltip, optionally include original prompt when custom title exists                                                                                            | Users need both custom name and original prompt context.                                                                                                              |
| History highlight in [`TaskItem`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx:74)                             | [`item.highlight`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx:74)                                                                                                                      | Highlight display title, not always original prompt                                                                                                                              | Search result text must match rendered text.                                                                                                                          |
| Footer copy button in [`TaskItemFooter`](Zoo-Code/webview-ui/src/components/history/TaskItemFooter.tsx:19)                | [`item.task`](Zoo-Code/webview-ui/src/components/history/TaskItemFooter.tsx:58)                                                                                                                     | Keep [`task`](Zoo-Code/packages/types/src/history.ts:13)                                                                                                                         | Button label is copy prompt, not copy display name.                                                                                                                   |
| Subtask row in [`SubtaskRow`](Zoo-Code/webview-ui/src/components/history/SubtaskRow.tsx:26)                               | [`item.task`](Zoo-Code/webview-ui/src/components/history/SubtaskRow.tsx:52)                                                                                                                         | [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) fallback to [`task`](Zoo-Code/packages/types/src/history.ts:13)                                                        | Subtasks are still tasks and should support rename consistently.                                                                                                      |
| Active task copy action in [`TaskActions`](Zoo-Code/webview-ui/src/components/chat/TaskActions.tsx:19)                    | [`item.task`](Zoo-Code/webview-ui/src/components/chat/TaskActions.tsx:37)                                                                                                                           | Keep [`task`](Zoo-Code/packages/types/src/history.ts:13)                                                                                                                         | It copies the original prompt.                                                                                                                                        |
| Active chat header in [`TaskHeader`](Zoo-Code/webview-ui/src/components/chat/TaskHeader.tsx:42)                           | [`task.text`](Zoo-Code/webview-ui/src/components/chat/TaskHeader.tsx:155)                                                                                                                           | [`currentTaskItem.customTitle`](Zoo-Code/webview-ui/src/components/chat/TaskHeader.tsx:59) fallback to [`task.text`](Zoo-Code/webview-ui/src/components/chat/TaskHeader.tsx:155) | Critical: the prop is a [`ClineMessage`](Zoo-Code/packages/types/src/vscode-extension-host.ts:259), not a [`HistoryItem`](Zoo-Code/packages/types/src/history.ts:31). |
| Expanded active header in [`TaskHeader`](Zoo-Code/webview-ui/src/components/chat/TaskHeader.tsx:293)                      | [`task.text`](Zoo-Code/webview-ui/src/components/chat/TaskHeader.tsx:293)                                                                                                                           | Same display resolver as collapsed header                                                                                                                                        | Avoid inconsistent collapsed/expanded labels.                                                                                                                         |
| Active task source in [`ChatView`](Zoo-Code/webview-ui/src/components/chat/ChatView.tsx:134)                              | First message from messages array                                                                                                                                                                   | Do not mutate this                                                                                                                                                               | First message remains original prompt and should not become a title store.                                                                                            |
| History preview in [`HistoryPreview`](Zoo-Code/webview-ui/src/components/history/HistoryPreview.tsx:10)                   | Indirect via [`TaskItem`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx:24)                                                                                                               | Inherits [`TaskItem`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx:24) behavior                                                                                       | No separate logic.                                                                                                                                                    |
| History grouping in [`TaskGroupItem`](Zoo-Code/webview-ui/src/components/history/TaskGroupItem.tsx:36)                    | Indirect via [`TaskItem`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx:24) and [`SubtaskRow`](Zoo-Code/webview-ui/src/components/history/SubtaskRow.tsx:26)                              | Inherits child behavior                                                                                                                                                          | No separate logic.                                                                                                                                                    |
| Prompt history in [`usePromptHistory()`](Zoo-Code/webview-ui/src/components/chat/hooks/usePromptHistory.ts:27)            | [`item.task`](Zoo-Code/webview-ui/src/components/chat/hooks/usePromptHistory.ts:67)                                                                                                                 | Keep [`task`](Zoo-Code/packages/types/src/history.ts:13)                                                                                                                         | Arrow-up recall should restore the original typed prompt, not the friendly title.                                                                                     |
| CLI history picker in [`HistoryTrigger`](Zoo-Code/apps/cli/src/ui/components/autocomplete/triggers/HistoryTrigger.tsx:91) | [`item.task`](Zoo-Code/apps/cli/src/ui/components/autocomplete/triggers/HistoryTrigger.tsx:126) and [`item.task`](Zoo-Code/apps/cli/src/ui/components/autocomplete/triggers/HistoryTrigger.tsx:146) | Display [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) fallback to [`task`](Zoo-Code/packages/types/src/history.ts:13), search both                                   | CLI is another user-facing task selector.                                                                                                                             |

### UI Ownership Conclusion

The UI should not own title state. It should call a small shared display resolver, conceptually named [`getTaskDisplayTitle()`](Zoo-Code/webview-ui/src/components/history/types.ts:6), that reads [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) then falls back to [`task`](Zoo-Code/packages/types/src/history.ts:13). Copy-prompt and prompt-history features should intentionally continue using [`task`](Zoo-Code/packages/types/src/history.ts:13).

---

## 4. Search

### Recommendation

Search should match both [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) and [`task`](Zoo-Code/packages/types/src/history.ts:13), with display-title highlighting based on what the user sees.

### Current Evidence

[`useTaskSearch()`](Zoo-Code/webview-ui/src/components/history/useTaskSearch.ts:9) currently builds an [`Fzf`](Zoo-Code/webview-ui/src/components/history/useTaskSearch.ts:34) index with selector [`item.task`](Zoo-Code/webview-ui/src/components/history/useTaskSearch.ts:36). Highlighting also assumes match positions belong to [`result.item.task`](Zoo-Code/webview-ui/src/components/history/useTaskSearch.ts:47).

### Desired Behavior

- Search should be case-insensitive if the underlying fuzzy library already behaves that way; do not add separate case normalization unless tests prove it is needed.
- Search should include original prompt content so a renamed task is still discoverable by its original request.
- Search should include custom title so a user can find a task by their chosen name.
- Fuzzy matching should remain compatible with [`Fzf`](Zoo-Code/webview-ui/src/components/history/useTaskSearch.ts:34).
- The displayed highlight should not produce confusing hidden matches. If the query matches only the original prompt while the row displays a custom title, show the custom title normally and rely on tooltip/original prompt preview, or add a secondary matched-original snippet later.

### Weighting

For webview history search, a pragmatic v1 is combined searchable text: custom title first, original prompt second. This naturally gives [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) earlier positions in fuzzy scoring without introducing a custom scorer.

For the CLI picker, [`fuzzysort.go()`](Zoo-Code/apps/cli/src/ui/components/autocomplete/triggers/HistoryTrigger.tsx:125) currently searches only key [`task`](Zoo-Code/apps/cli/src/ui/components/autocomplete/triggers/HistoryTrigger.tsx:126). The CLI adapter should add a display/search field while keeping [`task`](Zoo-Code/apps/cli/src/ui/components/autocomplete/triggers/HistoryTrigger.tsx:176) as original prompt data.

---

## 5. Rename UX

### Recommendation

Use existing inline rename patterns. Do not introduce a new modal-first UX.

### Existing Project Patterns

The previous research identified inline rename patterns in [`ApiConfigManager.tsx`](Zoo-Code/webview-ui/src/components/settings/ApiConfigManager.tsx) and [`ModesView.tsx`](Zoo-Code/webview-ui/src/components/modes/ModesView.tsx). Those patterns use edit affordance, inline input, save, and cancel. This is more consistent than inventing a new dialog.

### Proposed UX Contract

- Entry points: hover pencil action in the history row footer and optional context-menu action later.
- Input behavior: single-line input replacing the displayed title.
- Save: Enter or checkmark.
- Cancel: Escape or X.
- Blur: acceptable to save if validation passes; otherwise keep editing and surface error.
- Active chat header: should show renamed title but does not need inline editing in v1.
- Subtasks: same rename flow as root tasks.

### Why not double-click

[`TaskItem`](Zoo-Code/webview-ui/src/components/history/TaskItem.tsx:35) already uses click to open or select tasks. Double-click rename risks conflicting with existing click behavior and selection mode.

---

## 6. Validation Rules

### Validation Policy

Validation should live in a shared pure function used by both the webview and extension handler. The extension handler must be authoritative because webview validation can be bypassed.

### Rules

| Case                        | Rule                                                                                          | Rationale                                               |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Minimum length              | Require at least one visible character after trimming                                         | Prevent empty display labels.                           |
| Maximum length              | 120 Unicode grapheme clusters for v1                                                          | Long enough for meaningful labels, short enough for UI. |
| Whitespace-only             | Reject                                                                                        | Same as empty.                                          |
| Leading/trailing whitespace | Trim before saving                                                                            | Avoid visually invisible differences.                   |
| Internal spaces             | Preserve                                                                                      | User intent.                                            |
| Newlines                    | Reject or normalize to a single space; prefer reject in v1                                    | UI is single-line.                                      |
| Tabs                        | Normalize to a single space or reject; prefer normalize                                       | Prevent layout oddities.                                |
| Emoji                       | Allow                                                                                         | Valid user title content.                               |
| RTL text                    | Allow                                                                                         | Internationalization requirement.                       |
| Duplicates                  | Allow                                                                                         | Many tasks can have the same topic.                     |
| Unicode                     | Allow valid Unicode                                                                           | Avoid English-only bias.                                |
| Zero-width chars            | Remove common zero-width formatting characters unless needed for RTL; document this carefully | Prevent invisible titles and spoofing.                  |
| Empty after normalization   | Treat as clear-title action only if explicit reset is supported; otherwise reject             | Avoid ambiguity.                                        |

### Storage Semantics

There are two safe options for clearing a custom title:

1. Remove [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) from the item.
2. Set [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) to undefined and ensure the JSON writer omits it.

Do not store an empty string. Empty string creates ambiguous display behavior and complicates fallback logic.

---

## 7. Race Conditions

### Race Review

| Race                                    |   Risk | Existing protection                                                                                                                                                                               | Required behavior                                                                                           |
| --------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Rename while AI is responding           |    Low | [`TaskHistoryStore.withLock()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:574) serializes writes; merge preserves absent fields.                                                     | Use [`TaskHistoryStore.atomicReadAndUpdate()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:550). |
| Rename during message save              |    Low | [`Task.saveClineMessages()`](Zoo-Code/src/core/task/Task.ts:1063) writes through [`ClineProvider.updateTaskHistory()`](Zoo-Code/src/core/webview/ClineProvider.ts:2733), which uses store upsert. | Rename must not write direct files.                                                                         |
| Rename during resume                    |    Low | Resume goes through [`Task.resumeTaskFromHistory()`](Zoo-Code/src/core/task/Task.ts:1881), then metadata save.                                                                                    | Merge preserves [`customTitle`](Zoo-Code/packages/types/src/history.ts:7).                                  |
| Rename during history refresh           |    Low | Webview state applies latest item in [`ExtensionStateContext`](Zoo-Code/webview-ui/src/context/ExtensionStateContext.tsx:478).                                                                    | Broadcast renamed item after persistence.                                                                   |
| Two windows rename simultaneously       | Medium | In-process lock only protects one extension host. Cross-process file races can still last-writer-win.                                                                                             | Accept last-writer-wins for v1; consider file mtime conflict detection later.                               |
| Rename then delete                      |    Low | Delete removes task through [`TaskHistoryStore.delete()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:196).                                                                            | If rename handler cannot find item, return no-op or error notification.                                     |
| Delete then rename stale UI             |    Low | Rename handler should read from store and fail if missing.                                                                                                                                        | Do not recreate deleted tasks from stale webview state.                                                     |
| Rename during export                    |    Low | Current export reads conversation history, not title metadata.                                                                                                                                    | If export later includes title, read title immediately before export.                                       |
| Rename during import                    |    Low | Import stages and atomically renames task directories in [`importRooTaskHistory()`](Zoo-Code/src/core/task-persistence/importRooTaskHistory.ts:291).                                              | Existing tasks are skipped; imported renamed title preserved if schema supports it.                         |
| Undo rename                             |    Low | No undo stack exists for task metadata.                                                                                                                                                           | Not required for v1; user can rename again.                                                                 |
| Rename active task while header visible |    Low | [`taskHistoryItemUpdated`](Zoo-Code/packages/types/src/vscode-extension-host.ts:26) updates [`currentTaskItem`](Zoo-Code/webview-ui/src/context/ExtensionStateContext.tsx:497).                   | Header must derive from [`currentTaskItem`](Zoo-Code/webview-ui/src/components/chat/TaskHeader.tsx:59).     |

### Race Conclusion

The architecture is race-safe inside one extension host if it uses [`TaskHistoryStore.atomicReadAndUpdate()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:550). Cross-window simultaneous rename is not perfectly conflict-free, but last-writer-wins is acceptable for a non-critical user label.

---

## 8. Future Compatibility

### Compatibility Matrix

| Future feature      | Impact of [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) architecture                                                                                                   | Assessment                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Pinned chats        | No conflict; pin metadata can live alongside [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) on [`HistoryItem`](Zoo-Code/packages/types/src/history.ts:31).              | Compatible                         |
| Folders             | Compatible if folders store task IDs, not copied titles.                                                                                                                           | Compatible                         |
| Favorites           | Compatible as another metadata field.                                                                                                                                              | Compatible                         |
| Manual ordering     | Compatible as another sortable metadata field.                                                                                                                                     | Compatible                         |
| Tags                | Compatible; tags should be separate array metadata, not encoded in title.                                                                                                          | Compatible                         |
| Archived chats      | Compatible; archive state should not alter title fields.                                                                                                                           | Compatible                         |
| Sharing             | Need a clear policy: share original prompt only, custom title only, or both.                                                                                                       | Requires product decision          |
| Cloud sync          | Compatible if [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) is included in synced task metadata. Current task-message telemetry does not appear to require title text. | Compatible with sync schema update |
| Search improvements | Compatible; [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) can become a weighted field later.                                                                           | Compatible                         |
| Prompt templates    | Compatible because original [`task`](Zoo-Code/packages/types/src/history.ts:13) remains intact.                                                                                    | Compatible                         |
| Localization        | Compatible because user-generated titles should not be localized.                                                                                                                  | Compatible                         |

### Future-Proofing Principle

Keep original prompt, display title, tags, folders, pins, and archive status as separate metadata concepts. Do not overload [`task`](Zoo-Code/packages/types/src/history.ts:13) or [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) with unrelated organization data.

---

## 9. API Design

### Recommendation

Use a narrow webview message for v1, conceptually [`renameTask`](Zoo-Code/packages/types/src/vscode-extension-host.ts:442), backed internally by a generic store update helper if desired.

### Options

| API                                                                              | Pros                                                                     | Cons                                                                                                                 | Verdict                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [`renameTask`](Zoo-Code/packages/types/src/vscode-extension-host.ts:442)         | Clear intent, easy validation, small payload, safe authorization surface | Only solves one field                                                                                                | Best v1 public message                 |
| [`updateTaskMetadata`](Zoo-Code/packages/types/src/vscode-extension-host.ts:442) | Future-extensible                                                        | Larger attack surface; needs field allowlist; easier to misuse                                                       | Consider later internal/admin API only |
| Generic patch object                                                             | Flexible                                                                 | High risk of accidental overwrites of [`task`](Zoo-Code/packages/types/src/history.ts:13), status, delegation fields | Reject for v1                          |

### Handler Contract

The message should include task ID and requested title. The handler in [`webviewMessageHandler`](Zoo-Code/src/core/webview/webviewMessageHandler.ts:104) should:

1. Validate and normalize title.
2. Call [`TaskHistoryStore.atomicReadAndUpdate()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:550).
3. Modify only [`customTitle`](Zoo-Code/packages/types/src/history.ts:7).
4. Broadcast the updated item using the same per-item path as [`ClineProvider.updateTaskHistory()`](Zoo-Code/src/core/webview/ClineProvider.ts:2733).
5. Never write to [`task`](Zoo-Code/packages/types/src/history.ts:13).

### Why not expose generic patching now

Existing task metadata includes lifecycle-critical fields such as [`status`](Zoo-Code/packages/types/src/history.ts:23), [`childIds`](Zoo-Code/packages/types/src/history.ts:25), [`awaitingChildId`](Zoo-Code/packages/types/src/history.ts:26), and [`completionResultSummary`](Zoo-Code/packages/types/src/history.ts:28). A generic patch API risks corrupting delegation state unless heavily guarded. A narrow rename API is safer and more maintainable.

---

## 10. Final Risk Review

| Risk                                                                                           |        Rating | Mitigation                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | ------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storing custom title in [`task`](Zoo-Code/packages/types/src/history.ts:13) loses data on save |          High | Do not do this. Use [`customTitle`](Zoo-Code/packages/types/src/history.ts:7).                                                                                                          |
| Active header still shows original prompt                                                      |        Medium | Update [`TaskHeader`](Zoo-Code/webview-ui/src/components/chat/TaskHeader.tsx:42) to derive display from [`currentTaskItem`](Zoo-Code/webview-ui/src/components/chat/TaskHeader.tsx:59). |
| Search highlights wrong text                                                                   |        Medium | Update [`useTaskSearch()`](Zoo-Code/webview-ui/src/components/history/useTaskSearch.ts:9) so search text and rendered title are aligned.                                                |
| CLI history ignores custom titles                                                              |        Medium | Extend [`HistoryResult`](Zoo-Code/apps/cli/src/ui/components/autocomplete/triggers/HistoryTrigger.tsx:10) and search/render logic.                                                      |
| Import validation strips unknown fields if schema is not updated                               |        Medium | Add [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) to [`historyItemSchema`](Zoo-Code/packages/types/src/history.ts:7).                                                       |
| Cross-window last-writer-wins                                                                  | Low to Medium | Accept for v1; optionally add conflict detection later.                                                                                                                                 |
| New validation behavior rejects legitimate Unicode                                             |        Medium | Validate by visible length, not ASCII; allow emoji and RTL.                                                                                                                             |
| Empty title ambiguity                                                                          |           Low | Never persist empty string; remove [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) to clear.                                                                                  |
| Copy prompt accidentally copies display title                                                  |           Low | Keep copy actions using [`task`](Zoo-Code/packages/types/src/history.ts:13).                                                                                                            |
| Export semantics unclear                                                                       |           Low | Keep export conversation-first; optionally add metadata header with title.                                                                                                              |
| Future generic metadata API corrupts lifecycle fields                                          |        Medium | Use narrow [`renameTask`](Zoo-Code/packages/types/src/vscode-extension-host.ts:442) message for v1.                                                                                     |

---

## 11. Production Readiness

### Approval Status

Approved as production-quality architecture **if** the implementation follows these non-negotiable constraints:

- Add optional [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) to [`historyItemSchema`](Zoo-Code/packages/types/src/history.ts:7).
- Persist renames only through [`TaskHistoryStore.atomicReadAndUpdate()`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:550).
- Never mutate [`task`](Zoo-Code/packages/types/src/history.ts:13) during rename.
- Display user-facing titles with [`customTitle`](Zoo-Code/packages/types/src/history.ts:7) fallback to [`task`](Zoo-Code/packages/types/src/history.ts:13).
- Keep prompt recall and copy-prompt behavior tied to original [`task`](Zoo-Code/packages/types/src/history.ts:13).
- Update active header logic because [`TaskHeader`](Zoo-Code/webview-ui/src/components/chat/TaskHeader.tsx:42) receives a [`ClineMessage`](Zoo-Code/packages/types/src/vscode-extension-host.ts:259), not the persisted [`HistoryItem`](Zoo-Code/packages/types/src/history.ts:31).
- Update webview and CLI search to include both custom title and original prompt.
- Validate in both webview and extension, with extension validation authoritative.

### Final Architectural Judgment

The architecture is maintainable because it preserves the existing division of responsibilities:

- [`taskMetadata()`](Zoo-Code/src/core/task-persistence/taskMetadata.ts:30) remains the owner of derived system metadata.
- [`TaskHistoryStore`](Zoo-Code/src/core/task-persistence/TaskHistoryStore.ts:44) remains the persistence authority.
- [`ExtensionStateContext`](Zoo-Code/webview-ui/src/context/ExtensionStateContext.tsx:478) remains a derived synchronization layer.
- UI components remain presentation consumers rather than state owners.

The main design trap is the active chat header: it currently renders the first message text from [`ChatView`](Zoo-Code/webview-ui/src/components/chat/ChatView.tsx:134), so simply changing history rows would create inconsistent UX. Once that is addressed, this feature is low-risk and ready for implementation planning.
