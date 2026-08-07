# Upstream Decisions — Permanent Log

> **Every reviewed upstream commit appears here exactly once.**
> This is the permanent memory of all upstream decisions.
> No commit is ever reviewed twice if it appears in this file.

---

## 🔧 AUTO-MAINTENANCE RULES (DO NOT REMOVE)

**This file is SELF-MAINTAINING. No human instruction is required to keep it updated.**

### When to update this file

| Trigger                                | Action                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| A new commit is reviewed               | Add a new `###` section with hash, title, category, status, reason, reviewed date    |
| A commit is cherry-picked successfully | Change `**Status:**` from SKIPPED to IMPLEMENTED. Add `- **Imported:** <date>` line. |
| A cherry-pick fails                    | Keep status as SKIPPED. Add `- **Note:** Cherry-pick failed — <reason>` line.        |
| New upstream commits are fetched       | For each truly new commit (not already in this file), add a decision entry.          |

### Status transitions

| Current Status  | On Success    | On Failure                       |
| --------------- | ------------- | -------------------------------- |
| **SKIPPED**     | → IMPLEMENTED | stays SKIPPED (add failure note) |
| **IGNORED**     | NEVER changes | NEVER changes                    |
| **IMPLEMENTED** | Already done  | Already done                     |

### Entry format

```markdown
### `<short-hash>` — <commit title> (<PR#> if any)

- **Category:** <Bug Fix|Feature|Dependency|Refactor|Build|Docs>
- **Status:** <IMPLEMENTED|IGNORED|SKIPPED>
- **Reason:** <why this decision was made>
- **Reviewed:** <YYYY-MM-DD>
- **Imported:** <YYYY-MM-DD> ← (only if IMPLEMENTED)
```

### Cross-file consistency rule

After ANY update to this file, verify:

1. **STATE.json** `reviewedCommits[]` has matching status for every hash in this file
2. **IMPLEMENTATION_STATE.md** summary counts match the status counts in this file
3. Every hash appears exactly once in this file (no duplicates)

### Anti-duplicate rule

Before adding a new commit entry, search this file for its hash. If found, do NOT add it again.
Instead, update the existing entry's status if the cherry-pick outcome changed.

---

## Status Legend

| Status          | Meaning                                           |
| --------------- | ------------------------------------------------- |
| **IMPLEMENTED** | Cherry-picked or merged into our fork             |
| **IGNORED**     | Permanently rejected — must NEVER be re-suggested |
| **SKIPPED**     | Reviewed but deferred — ready for future import   |

---

## Decisions

---

### `31b7c51ff` — docs(prompt): enhance apply_diff tool instructions to improve Gemini model success rate (#619)

- **Category:** Docs
- **Status:** SKIPPED
- **Reason:** Low-risk prompt improvement. Good to have but not urgent. Ready for import when convenient.
- **Reviewed:** 2026-07-02

---

### `0084cc899` — Add completion change actions (#633)

- **Category:** Feature
- **Status:** SKIPPED
- **Reason:** Adds "See New Changes" buttons after AI edits. Useful UX improvement with 30 files touched including i18n. Ready for import — recommend pairing with related UI commits.
- **Reviewed:** 2026-07-02

---

### `667096238` — fix(delegation): serialize delegateParentAndOpenChild with atomicReadAndUpdate (#691)

- **Category:** Bug Fix
- **Status:** SKIPPED
- **Reason:** Critical race condition fix for task delegation. Should be imported together with commit `67df9f9c6` (reopenParentFromDelegation fix) as they address the same subsystem.
- **Reviewed:** 2026-07-02

---

### `1b26b6a69` — fix(diff-view): make auto-closing edited files opt-in (#720)

- **Category:** Bug Fix
- **Status:** IGNORED
- **Reason:** Zoo Code intentionally keeps the current UX. This change must NEVER be suggested again unless explicitly requested.
- **Reviewed:** 2026-07-02

---

### `f75b64e28` — feat(settings): add rules management UI (#657)

- **Category:** Feature
- **Status:** SKIPPED
- **Reason:** Major new feature — 34 files, new service layer, new UI components, full i18n. Needs careful review for Zoo-specific adaptations before import. High risk due to scope.
- **Reviewed:** 2026-07-02

---

### `34898d2bc` — fix: parse Gemma 4 `<thought>` reasoning tags alongside `<think>` (#324)

- **Category:** Bug Fix
- **Status:** SKIPPED
- **Reason:** Small, focused fix for Gemma 4 model support. Low risk, good test coverage. Ready for import.
- **Reviewed:** 2026-07-02

---

### `6705e67fd` — chore: prepare v3.64.0 release (#729)

- **Category:** Build
- **Status:** SKIPPED
- **Reason:** Release preparation is handled manually before releases. Version bumps and CHANGELOG updates conflict with our own versioning. Must NEVER be cherry-picked.
- **Reviewed:** 2026-07-02

---

### `1e9559198` — chore(deps): update dependency only-allow to v1.2.2 (#737)

- **Category:** Dependency
- **Status:** SKIPPED
- **Reason:** Minor dependency patch update. Should be imported as part of a dependency batch with commits `fdb07e6c0`, `12af5dee1`, `16dc13f27`, `4e68b5959`, `5587e2d36`, `d4741f608`, `9bc4e397c`, `83fc6bbf1`.
- **Reviewed:** 2026-07-02

---

### `fdb07e6c0` — chore(deps): update dependency pdf-parse to v1.1.4 (#739)

- **Category:** Dependency
- **Status:** SKIPPED
- **Reason:** Minor dependency patch. Batch with other dep updates.
- **Reviewed:** 2026-07-02

---

### `12af5dee1` — chore(deps): update dependency react-use to v17.6.1 (#740)

- **Category:** Dependency
- **Status:** SKIPPED
- **Reason:** Minor dependency patch. Batch with other dep updates.
- **Reviewed:** 2026-07-02

---

### `16dc13f27` — chore(deps): update dependency ovsx to v0.10.12 (#738)

- **Category:** Dependency
- **Status:** SKIPPED
- **Reason:** Dev-dependency for Open VSX publishing. Batch with other dep updates.
- **Reviewed:** 2026-07-02

---

### `4e68b5959` — chore(deps): update dependency reconnecting-eventsource to v1.6.5 (#741)

- **Category:** Dependency
- **Status:** SKIPPED
- **Reason:** Minor dependency patch. Batch with other dep updates.
- **Reviewed:** 2026-07-02

---

### `5b7ae240b` — chore: upgrade @anthropic-ai/sdk to 0.104.1 and @anthropic-ai/vertex-sdk to 0.17.1 (#600)

- **Category:** Dependency
- **Status:** SKIPPED
- **Reason:** Major Anthropic SDK upgrade. Should be imported with the AI SDK batch (`f63f7a9b3`) and tested with Zoo Gateway profile. Includes significant test additions.
- **Reviewed:** 2026-07-02

---

### `f63f7a9b3` — fix(deps): update ai sdks and providers (#744)

- **Category:** Dependency
- **Status:** SKIPPED
- **Reason:** Large batch update of AI SDKs (Vercel AI, Google GenAI, etc.). Should be paired with Anthropic SDK upgrade (`5b7ae240b`). Large lockfile diff.
- **Reviewed:** 2026-07-02

---

### `5587e2d36` — chore(deps): update dependency posthog-js to v1.393.4 (#746)

- **Category:** Dependency
- **Status:** SKIPPED
- **Reason:** Analytics library patch. Batch with other dep updates.
- **Reviewed:** 2026-07-02

---

### `d4741f608` — chore(deps): update dependency ajv to v8.20.0 (#747)

- **Category:** Dependency
- **Status:** SKIPPED
- **Reason:** JSON schema validator patch. Batch with other dep updates.
- **Reviewed:** 2026-07-02

---

### `9bc4e397c` — chore(deps): update dependency mermaid to v11.16.0 (#742)

- **Category:** Dependency
- **Status:** SKIPPED
- **Reason:** Diagramming library minor update. Batch with other dep updates.
- **Reviewed:** 2026-07-02

---

### `83fc6bbf1` — chore(deps): update build, lint, and test tooling (#745)

- **Category:** Dependency
- **Status:** SKIPPED
- **Reason:** Major dev-tooling update (TypeScript, ESLint, Vitest, esbuild). May require adapting our ESLint config overrides. Batch with other dep updates.
- **Reviewed:** 2026-07-02

---

### `78e11a766` — fix: LiteLLM cache key collision and silent fallback to non-existent default model (#647)

- **Category:** Bug Fix
- **Status:** SKIPPED
- **Reason:** Two related LiteLLM bugs fixed — cache key collision and silent fallback. Good fix with comprehensive tests. Ready for import.
- **Reviewed:** 2026-07-02

---

### `515437b45` — fix: shell default profile name type guard (#687)

- **Category:** Bug Fix
- **Status:** SKIPPED
- **Reason:** Prevents crash when shell profile name is not a string. Low risk, good test coverage. Ready for import.
- **Reviewed:** 2026-07-02

---

### `8849f1a00` — chore: enforce no-floating-promises in core/task/ (#253)

- **Category:** Refactor
- **Status:** IMPLEMENTED
- **Reason:** Enables stricter ESLint rule for async error catching. Applied cleanly via cherry-pick.
- **Reviewed:** 2026-07-02
- **Imported:** 2026-07-02
- **Local SHA:** `2490eeb08`

---

### `80fb15906` — ci: improve PR label reconciliation with CI gating and event triggers (#228)

- **Category:** Build
- **Status:** IMPLEMENTED
- **Reason:** CI workflow improvements. Applied cleanly via cherry-pick.
- **Reviewed:** 2026-07-02
- **Imported:** 2026-07-02
- **Local SHA:** `c99e1e6f4`

---

### `67df9f9c6` — fix(delegation): atomically serialize reopenParentFromDelegation (#725)

- **Category:** Bug Fix
- **Status:** IMPLEMENTED
- **Reason:** Critical delegation fix. Applied cleanly via cherry-pick. Large test expansion (784 insertions).
- **Reviewed:** 2026-07-02
- **Imported:** 2026-07-02
- **Local SHA:** `063405457`

---

### `9a2e8d866` — fix(vscode-lm): reliable auto context condensing (#710)

- **Category:** Bug Fix
- **Status:** IMPLEMENTED
- **Reason:** Fixes unreliable context condensing for VS Code LM provider. Had conflicts in vscode-lm.ts and useSelectedModel.ts — resolved via `--strategy-option=theirs` + Zoo Code custom work re-applied (enhanced selector handling with `selector?.id`, `selector?.info`, `baseInfo`).
- **Reviewed:** 2026-07-02
- **Imported:** 2026-07-02
- **Local SHA:** `cd0906b0e`

---

### `211d36063` — fix(ThinkingBudget): support xhigh and all extended reasoning effort values (#713) (#774)

- **Category:** Bug Fix
- **Status:** IMPLEMENTED
- **Reason:** Small UI fix for reasoning effort selector. Applied cleanly via cherry-pick.
- **Reviewed:** 2026-07-02
- **Imported:** 2026-07-02
- **Local SHA:** `5ef31ba`

---

### `f845f2aa5` — feat: implement Claude Sonnet 5 support in Zoo Code (#778)

- **Category:** Feature
- **Status:** IMPLEMENTED
- **Reason:** Adds Claude Sonnet 5 across all providers. Applied cleanly via cherry-pick. 19 files, 430 insertions.
- **Reviewed:** 2026-07-02
- **Imported:** 2026-07-02
- **Local SHA:** `dd2f18a`

---

### `7476c6794` — feat(task-lifecycle): task status transition guard and startup delegation reconciliation (#692)

- **Category:** Feature
- **Status:** IMPLEMENTED
- **Reason:** Adds state machine guard for task transitions and startup reconciliation. Applied cleanly via cherry-pick (auto-merged ClineProvider.ts). 20 files, 951 insertions.
- **Reviewed:** 2026-07-02
- **Imported:** 2026-07-02
- **Local SHA:** `d0871ec81`

---

### `63dec51c1` — fix(#689): provider cache reset after settings import (#726)

- **Category:** Bug Fix
- **Status:** IMPLEMENTED
- **Reason:** Small fix for stale provider cache after settings import. Applied cleanly via cherry-pick (auto-merged SettingsView.tsx).
- **Reviewed:** 2026-07-02
- **Imported:** 2026-07-02
- **Local SHA:** `9b9a750`

---

### `29c2d2e22` — fix(gemini): base64 encoding though signature (#776)

- **Category:** Bug Fix
- **Status:** IMPLEMENTED
- **Reason:** Fixes Gemini image encoding. Applied cleanly via cherry-pick.
- **Reviewed:** 2026-07-02
- **Imported:** 2026-07-02
- **Local SHA:** `c64bf09`

---

## Recommended Import Batches

### Batch A — Dependency Updates (Import Together)

`1e9559198`, `fdb07e6c0`, `12af5dee1`, `16dc13f27`, `4e68b5959`, `5587e2d36`, `d4741f608`, `9bc4e397c`, `83fc6bbf1`, `5b7ae240b`, `f63f7a9b3`

### Batch B — Delegation System Fixes (Import Together, Order Matters) — **Partially imported**

`667096238` → `67df9f9c6` ✅ → `7476c6794` ✅

> `667096238` not yet imported (separate commit needed).

### Batch C — Standalone Bug Fixes (Import Individually) — **Partially imported**

`34898d2bc`, `78e11a766`, `515437b45`, `9a2e8d866` ✅, `211d36063` ✅, `63dec51c1` ✅, `29c2d2e22` ✅

### Batch D — Features (Import With Care) — **Partially imported**

`0084cc899`, `f75b64e28`, `f845f2aa5` ✅

### Batch E — Quality & Docs (Import When Convenient) — **Partially imported**

`31b7c51ff`, `8849f1a00` ✅

### Permanently Blocked

`1b26b6a69` (IGNORED), `6705e67fd` (release prep), `80fb15906` ✅ (CI — imported)

### Deferred — CI Workflows (Imported 2026-07-02)

`80fb15906` was previously deferred as CI-only but was imported during this session.

> **Auto-update rule:** When commits from a batch are imported, update their status to
> IMPLEMENTED above and add the batch note "Partially imported" or "Fully imported" here.
