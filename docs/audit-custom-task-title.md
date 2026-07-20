# Production-Hardening Audit: Custom Task Title & Extension Branding

> **Audit date:** 2026-06-30
> **Scope:** Custom Task Title feature (code, UX, performance, accessibility) + VS Code Activity Bar / Marketplace icon / VSIX branding pipeline
> **Method:** Read-only codebase review against approved architecture documents
> **Verdict:** No Phase 1 blockers found. Feature is production-ready with recommended Phase 2 improvements.

---

## Executive Summary

The Custom Task Title feature is **architecturally sound** and correctly implemented across all touchpoints: shared types, extension host persistence, webview UI, CLI, search, import/export, and i18n. The merge-preserving persistence pattern (`{ ...existing, ...item }` in [`_upsertUnlocked()`](../src/core/task-persistence/TaskHistoryStore.ts:168)) correctly protects `customTitle` from being overwritten by concurrent `taskMetadata()` saves. The atomic update pattern via [`atomicReadAndUpdate()`](../src/core/task-persistence/TaskHistoryStore.ts:550) eliminates race conditions. XSS is prevented by [`escapeHtml()`](../webview-ui/src/utils/highlight.ts:6) in the search highlight pipeline.

**No issues block release.** Five Phase 2 items are recommended for improved UX, accessibility, and maintainability. Three Phase 3 items are documented for future iteration.

---

## Implementation Touchpoint Map

| Surface                   | File                                                                                                                                               | customTitle Usage                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Schema & helpers**      | [`packages/types/src/history.ts`](../packages/types/src/history.ts:1)                                                                              | Zod schema, `getTaskDisplayTitle()`, `getTaskSearchText()`, `validateTaskCustomTitle()` |
| **Persistence**           | [`src/core/task-persistence/TaskHistoryStore.ts`](../src/core/task-persistence/TaskHistoryStore.ts:1)                                              | Merge-preserving `_upsertUnlocked()`, `atomicReadAndUpdate()`                           |
| **Task metadata**         | [`src/core/task-persistence/taskMetadata.ts`](../src/core/task-persistence/taskMetadata.ts:1)                                                      | Does NOT include `customTitle` (intentional — preserves during merge)                   |
| **Extension host rename** | [`src/core/webview/ClineProvider.ts`](../src/core/webview/ClineProvider.ts:2765)                                                                   | `renameTask()` via `atomicReadAndUpdate`, broadcast via `taskHistoryItemUpdated`        |
| **Message handler**       | [`src/core/webview/webviewMessageHandler.ts`](../src/core/webview/webviewMessageHandler.ts:884)                                                    | Server-side validation, delegates to `provider.renameTask()`                            |
| **History item UI**       | [`webview-ui/src/components/history/TaskItem.tsx`](../webview-ui/src/components/history/TaskItem.tsx:33)                                           | Inline rename, display title, tooltip, validation                                       |
| **Subtask row**           | [`webview-ui/src/components/history/SubtaskRow.tsx`](../webview-ui/src/components/history/SubtaskRow.tsx:29)                                       | Display only via `getTaskDisplayTitle()`, no rename                                     |
| **Footer actions**        | [`webview-ui/src/components/history/TaskItemFooter.tsx`](../webview-ui/src/components/history/TaskItemFooter.tsx:21)                               | Rename button, copy uses `item.task` (not display title)                                |
| **Search**                | [`webview-ui/src/components/history/useTaskSearch.ts`](../webview-ui/src/components/history/useTaskSearch.ts:10)                                   | FZF via `getTaskSearchText()`, highlight filtering for `customTitle`                    |
| **Active task header**    | [`webview-ui/src/components/chat/TaskHeader.tsx`](../webview-ui/src/components/chat/TaskHeader.tsx:156)                                            | `getTaskDisplayTitle(currentTaskItem)`                                                  |
| **State sync**            | [`webview-ui/src/context/ExtensionStateContext.tsx`](../webview-ui/src/context/ExtensionStateContext.tsx:478)                                      | Incremental `taskHistoryItemUpdated` merge                                              |
| **Grouped tasks**         | [`webview-ui/src/components/history/TaskGroupItem.tsx`](../webview-ui/src/components/history/TaskGroupItem.tsx:42)                                 | Passes rename props to parent `TaskItem`                                                |
| **History view**          | [`webview-ui/src/components/history/HistoryView.tsx`](../webview-ui/src/components/history/HistoryView.tsx:55)                                     | `renamingTaskId` state, passes to both search flat and grouped modes                    |
| **CLI history**           | [`apps/cli/src/ui/components/autocomplete/triggers/HistoryTrigger.tsx`](../apps/cli/src/ui/components/autocomplete/triggers/HistoryTrigger.tsx:94) | `getTaskSearchText()` + `getTaskDisplayTitle()`                                         |
| **Import**                | [`src/core/task-persistence/importRooTaskHistory.ts`](../src/core/task-persistence/importRooTaskHistory.ts:92)                                     | `historyItemSchema.safeParse()` — `customTitle` now in schema                           |
| **Message types**         | [`packages/types/src/vscode-extension-host.ts`](../packages/types/src/vscode-extension-host.ts:442)                                                | `WebviewMessage.renameTask`, `ExtensionMessage.taskHistoryItemUpdated`                  |
| **i18n**                  | `webview-ui/src/i18n/locales/*/history.json`                                                                                                       | `renameTask`, `renamePlaceholder` keys (18 locales)                                     |

---

## Phase 1: Must Fix Before Release

**No Phase 1 issues found.**

The feature is architecturally correct, persistently safe, and functionally complete. All critical paths (rename, display, search, persistence, state sync, import) are implemented and tested.

---

## Phase 2: Strongly Recommended

### 2.1 — Missing `maxLength` attribute on rename input

| Field               | Value                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**        | Low                                                                                                                                                                                                                   |
| **Component**       | [`TaskItem.tsx:119-134`](../webview-ui/src/components/history/TaskItem.tsx:119)                                                                                                                                       |
| **Description**     | The rename `<input>` element has no `maxLength={200}` attribute. Users can type beyond [`CUSTOM_TITLE_MAX_LENGTH`](../packages/types/src/history.ts:73) (200 chars) and only discover the limit on save (blur/Enter). |
| **Root Cause**      | The input was created without an HTML-level length constraint; validation is deferred to the blur/Enter handler.                                                                                                      |
| **Why it matters**  | Poor UX — user types a long title, clicks away, and the rename silently fails with no visual feedback. The user sees the input close but the title unchanged, which is confusing.                                     |
| **Best solution**   | Add `maxLength={CUSTOM_TITLE_MAX_LENGTH}` to the `<input>` element. Import `CUSTOM_TITLE_MAX_LENGTH` from `@roo-code/types`.                                                                                          |
| **Regression risk** | None — purely additive HTML attribute.                                                                                                                                                                                |
| **Verdict**         | **Postponable but recommended.** Does not affect correctness, only UX polish.                                                                                                                                         |

### 2.2 — Missing `aria-label` on rename input

| Field               | Value                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**        | Low                                                                                                                                                               |
| **Component**       | [`TaskItem.tsx:119-134`](../webview-ui/src/components/history/TaskItem.tsx:119)                                                                                   |
| **Description**     | The rename `<input>` has no `aria-label` attribute. Screen readers will announce it as a generic text field without context.                                      |
| **Root Cause**      | Accessibility was not explicitly addressed for the inline rename input.                                                                                           |
| **Why it matters**  | Users relying on screen readers cannot distinguish the rename input from other text fields. WCAG 2.1 Level A requires labels for form controls (SC 1.3.1, 4.1.2). |
| **Best solution**   | Add `aria-label={t("history:renameTask")}` to the `<input>`. The i18n key already exists in all 18 locales.                                                       |
| **Regression risk** | None — purely additive attribute.                                                                                                                                 |
| **Verdict**         | **Postponable but recommended.** Accessibility gap, low functional risk.                                                                                          |

### 2.3 — Unused `renamePlaceholder` i18n key

| Field               | Value                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**        | Informational                                                                                                                                                                                                  |
| **Component**       | [`webview-ui/src/i18n/locales/en/history.json:52`](../webview-ui/src/i18n/locales/en/history.json:52) + [`TaskItem.tsx:119-134`](../webview-ui/src/components/history/TaskItem.tsx:119)                        |
| **Description**     | The i18n key `renamePlaceholder` ("Enter task name...") is defined in all 18 locale files but is **never referenced** in any `.tsx` or `.ts` source file. The rename `<input>` has no `placeholder` attribute. |
| **Root Cause**      | The key was likely added in anticipation of use but the placeholder was never wired up in the component.                                                                                                       |
| **Why it matters**  | Dead code in locale files. Minor maintenance burden. Could also indicate the placeholder was intentionally omitted — in which case the key should be removed to avoid confusion.                               |
| **Best solution**   | Either: (a) wire up `placeholder={t("history:renamePlaceholder")}` on the input, or (b) remove the key from all 18 locale files. Option (a) improves discoverability.                                          |
| **Regression risk** | None — either adding a placeholder or removing dead keys is safe.                                                                                                                                              |
| **Verdict**         | **Postponable.** Minor cleanup item.                                                                                                                                                                           |

### 2.4 — `delete (updated as any).customTitle` type safety concern

| Field               | Value                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**        | Low                                                                                                                                                                                                                                                                                                                                     |
| **Component**       | [`ClineProvider.ts:2772`](../src/core/webview/ClineProvider.ts:2772)                                                                                                                                                                                                                                                                    |
| **Description**     | The code uses `delete (updated as any).customTitle` to clear the custom title. The `as any` cast bypasses TypeScript's type checking.                                                                                                                                                                                                   |
| **Root Cause**      | `HistoryItem` has `customTitle?: z.string().optional()`, which TypeScript allows setting to `undefined` but not deleting. The `delete` operator was chosen to ensure the key is absent from the serialized JSON (not just `undefined`).                                                                                                 |
| **Why it matters**  | `as any` suppresses type errors. If the `HistoryItem` type changes (e.g., `customTitle` is renamed), this line will silently break without a compile error.                                                                                                                                                                             |
| **Best solution**   | Replace with `updated.customTitle = undefined`. The `_upsertUnlocked` merge (`{ ...existing, ...item }`) will overwrite the existing value with `undefined`, and the JSON serialization will omit `undefined` values. Alternatively, use a typed helper: `const { customTitle: _omit, ...rest } = updated; return rest as HistoryItem`. |
| **Regression risk** | Low — `undefined` values are omitted by `JSON.stringify()` by default, so behavior is identical.                                                                                                                                                                                                                                        |
| **Verdict**         | **Postponable.** Functional correctness is not affected, but type safety should be restored.                                                                                                                                                                                                                                            |

### 2.5 — Rename input lacks visual feedback on validation failure

| Field               | Value                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**        | Low                                                                                                                                                                                                                                                                                                                                       |
| **Component**       | [`TaskItem.tsx:56-64`](../webview-ui/src/components/history/TaskItem.tsx:56)                                                                                                                                                                                                                                                              |
| **Description**     | When [`validateTaskCustomTitle()`](../packages/types/src/history.ts:99) returns `{ ok: false }` (title too long), [`handleSaveRename()`](../webview-ui/src/components/history/TaskItem.tsx:56) silently returns without saving and without informing the user. The input remains open but the user gets no indication of what went wrong. |
| **Root Cause**      | Validation failure path only returns early — no error state or visual feedback is rendered.                                                                                                                                                                                                                                               |
| **Why it matters**  | If `maxLength` (Phase 2.1) is added, this becomes a non-issue for the length case. But for any future validation rules, the silent failure pattern is problematic.                                                                                                                                                                        |
| **Best solution**   | With `maxLength` on the input, the length case is prevented at the HTML level. For defense-in-depth, consider showing a brief red border or inline error message on validation failure.                                                                                                                                                   |
| **Regression risk** | None if implemented as a visual-only change.                                                                                                                                                                                                                                                                                              |
| **Verdict**         | **Postponable.** Mitigated by adding `maxLength` (2.1).                                                                                                                                                                                                                                                                                   |

---

## Phase 3: Future Improvements

### 3.1 — Add rename capability to SubtaskRow

| Field              | Value                                                                                                                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Component**      | [`SubtaskRow.tsx`](../webview-ui/src/components/history/SubtaskRow.tsx:29)                                                                                                                                                                                                                                      |
| **Description**    | [`SubtaskRow`](../webview-ui/src/components/history/SubtaskRow.tsx:29) uses [`getTaskDisplayTitle()`](../packages/types/src/history.ts:49) for display but has no rename button or inline rename UI. Only parent tasks (via [`TaskItem`](../webview-ui/src/components/history/TaskItem.tsx:33)) can be renamed. |
| **Rationale**      | This is **by design** per the architecture — subtasks are navigational rows, not primary task cards. However, users may want to rename subtasks for clarity in complex delegation trees.                                                                                                                        |
| **Recommendation** | Defer to a future iteration. If added, reuse the same [`validateTaskCustomTitle()`](../packages/types/src/history.ts:99) + [`renameTask`](../src/core/webview/ClineProvider.ts:2765) message flow.                                                                                                              |

### 3.2 — Keyboard shortcut for rename (F2)

| Field              | Value                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Component**      | [`HistoryView.tsx`](../webview-ui/src/components/history/HistoryView.tsx:55)                                                       |
| **Description**    | There is no keyboard shortcut to initiate rename on a focused task item. Users must hover to reveal the pencil icon button.        |
| **Recommendation** | Consider adding `onKeyDown` handler for F2 key on the task item container to trigger rename, matching VS Code's rename convention. |

### 3.3 — Binary insert for large task histories

| Field              | Value                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Component**      | [`ExtensionStateContext.tsx:493`](../webview-ui/src/context/ExtensionStateContext.tsx:493)                                                                                        |
| **Description**    | On every `taskHistoryItemUpdated`, the full history array is re-sorted: `nextHistory.sort((a, b) => b.ts - a.ts)`. For histories with 1000+ items, this is O(n log n) per rename. |
| **Recommendation** | Use binary insert for the single updated item (O(log n) find + O(n) splice) instead of full sort. Low priority — only matters for power users with very large histories.          |

---

## Branding Pipeline Audit: Activity Bar / Marketplace / VSIX

### Pipeline Overview

| Step                            | Path                                                                                      | Status                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Source icons**                | [`src/assets/icons/`](../src/assets/icons/)                                               | ✅ Present: `icon.svg`, `icon.png`, `icon-nightly.png`, `panel_dark.png`, `panel_light.png` |
| **package.json — Marketplace**  | [`src/package.json:7`](../src/package.json:7)                                             | ✅ `"icon": "assets/icons/icon.png"`                                                        |
| **package.json — Activity Bar** | [`src/package.json:59`](../src/package.json:59)                                           | ✅ `"icon": "assets/icons/icon.svg"`                                                        |
| **.vscodeignore**               | [`src/.vscodeignore:32`](../src/.vscodeignore:32)                                         | ✅ `!assets/icons/**` (explicit inclusion)                                                  |
| **VSIX package.json**           | [`bin/vsix-check/extension/package.json:7`](../bin/vsix-check/extension/package.json:7)   | ✅ `"icon": "assets/icons/icon.png"` — matches source                                       |
| **VSIX Activity Bar**           | [`bin/vsix-check/extension/package.json:59`](../bin/vsix-check/extension/package.json:59) | ✅ `"icon": "assets/icons/icon.svg"` — matches source                                       |
| **VSIX icon files**             | [`bin/vsix-check/extension/assets/icons/`](../bin/vsix-check/extension/assets/icons/)     | ✅ All 5 icon files present in VSIX                                                         |
| **esbuild pipeline**            | [`src/esbuild.mjs`](../src/esbuild.mjs)                                                   | ✅ Icons are NOT processed by esbuild (correct — packaged directly by `vsce`)               |

### Branding Verdict

**No issues found.** The icon pipeline is correct end-to-end:

1. Source assets exist in [`src/assets/icons/`](../src/assets/icons/)
2. [`package.json`](../src/package.json:7) correctly references both Marketplace icon (`icon.png`) and Activity Bar icon (`icon.svg`)
3. [`.vscodeignore`](../src/.vscodeignore:32) explicitly includes `!assets/icons/**`
4. The built VSIX in [`bin/vsix-check/extension/`](../bin/vsix-check/extension/) contains all 5 icon files with correct paths
5. `package.json` references in the VSIX match the source exactly
6. Icons are not processed by esbuild — they're packaged raw by `vsce`, which is correct for static assets

**Activity Bar icon** (`icon.svg`): Present in VSIX at `extension/assets/icons/icon.svg`. SVG format is required by VS Code for Activity Bar icons.

**Marketplace icon** (`icon.png`): Present in VSIX at `extension/assets/icons/icon.png`. PNG format is required by the VS Code Marketplace.

---

## Test Coverage Summary

| Test file                                                                                                                                                                     | Coverage                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`packages/types/src/__tests__/history.test.ts`](../packages/types/src/__tests__/history.test.ts)                                                                             | Schema parsing, `getTaskDisplayTitle()`, `getTaskSearchText()`, `validateTaskCustomTitle()` — 14 tests |
| [`src/core/webview/__tests__/webviewMessageHandler.renameTask.spec.ts`](../src/core/webview/__tests__/webviewMessageHandler.renameTask.spec.ts)                               | Handler validation, missing taskId, missing item, validation failure — 5 tests                         |
| [`webview-ui/src/components/history/__tests__/TaskItem.spec.tsx`](../webview-ui/src/components/history/__tests__/TaskItem.spec.tsx)                                           | Custom title display, rename mode, validation pass/fail, rename button — 8 tests                       |
| [`webview-ui/src/components/history/__tests__/SubtaskRow.spec.tsx`](../webview-ui/src/components/history/__tests__/SubtaskRow.spec.tsx)                                       | Leaf/node rendering, click behavior, expand/collapse — 10 tests                                        |
| [`webview-ui/src/components/history/__tests__/TaskGroupItem.spec.tsx`](../webview-ui/src/components/history/__tests__/TaskGroupItem.spec.tsx)                                 | Parent rendering, subtask count, expand/collapse, selection mode — 12 tests                            |
| [`apps/cli/src/ui/components/autocomplete/triggers/__tests__/HistoryTrigger.test.tsx`](../apps/cli/src/ui/components/autocomplete/triggers/__tests__/HistoryTrigger.test.tsx) | Custom title search, display, fuzzy matching — 4 tests                                                 |

**Coverage assessment:** Core paths (schema, validation, display, search, rename flow, persistence) are well covered. The `renamePlaceholder` i18n gap and `maxLength` absence are not testable issues — they're UI polish items.

---

## Summary

| Phase                     | Count | Verdict                                          |
| ------------------------- | ----- | ------------------------------------------------ |
| **Phase 1 (Must fix)**    | **0** | ✅ No blockers — ship as-is                      |
| **Phase 2 (Recommended)** | **5** | ⚠️ UX/a11y polish — safe to defer to next sprint |
| **Phase 3 (Future)**      | **3** | ℹ️ Enhancement backlog                           |
| **Branding pipeline**     | **0** | ✅ End-to-end verified — no issues               |
