# Upstream Implementation State

> **Single source of truth** for the Zoo Code fork's upstream sync status.
> All upstream review workflows MUST read this file before taking action.

---

## 🔧 AUTO-MAINTENANCE RULES (DO NOT REMOVE)

**This file is SELF-MAINTAINING. No human instruction is required to keep it updated.**

### When to update this file

| Trigger                                       | Action                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A commit is cherry-picked/merged successfully | Move the commit from "Awaiting Import" to "Implemented". Update counts. Update "Last Fully Integrated Upstream Commit" to this commit. |
| A cherry-pick/merge FAILS                     | Keep the commit in "Awaiting Import". Do NOT change Last Fully Integrated.                                                             |
| New upstream commits are fetched              | Update "Current Upstream Review Window" To/From fields. Add new commits to UPSTREAM_DECISIONS.md first, then update summaries here.    |
| Any upstream integration happens              | Read STATE.json → Update IMPLEMENTATION_STATE.md → Verify UPSTREAM_DECISIONS.md agrees                                                 |

### Status transitions

| Current Status  | On Success    | On Failure    |
| --------------- | ------------- | ------------- |
| **SKIPPED**     | → IMPLEMENTED | stays SKIPPED |
| **IGNORED**     | NEVER changes | NEVER changes |
| **IMPLEMENTED** | Already done  | Already done  |

### Cross-file consistency rule

After ANY update to this file, verify:

1. **STATE.json** `reviewedCommits[]` has matching status for every hash mentioned here
2. **UPSTREAM_DECISIONS.md** has matching status for every commit mentioned here
3. Total commit counts match across all three files
4. `lastSyncCommit` in STATE.json equals the most recent IMPLEMENTED commit's hash

### How to find what needs updating

```
1. Read STATE.json → get reviewedCommits[], lastSyncCommit
2. Read this file → get current summary counts
3. Read UPSTREAM_DECISIONS.md → get per-commit statuses
4. If any discrepancy → fix ALL three files to agree
```

---

## Last Fully Integrated Upstream Commit

| Field              | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| **Hash**           | `29c2d2e2284fe9a492e32a78d1c2367d7cad4cd5`                   |
| **Date**           | 2026-07-01                                                   |
| **Title**          | `fix(gemini): base64 encoding (#776)`                        |
| **Local SHA**      | `c64bf09`                                                    |
| **How identified** | Cherry-picked from upstream during import session 2026-07-02 |

> **Auto-update rule:** When a new commit is successfully cherry-picked, update this table
> to reflect the new commit. The hash must match `lastSyncCommit` in STATE.json.

---

## Current Upstream Review Window

| Field                      | Value                                                   |
| -------------------------- | ------------------------------------------------------- |
| **From**                   | `e8acc6a498a794d5e07f5a4238155326ec82e1c4` (2026-06-24) |
| **To**                     | `29c2d2e2284fe9a492e32a78d1c2367d7cad4cd5` (2026-07-01) |
| **Total commits reviewed** | 29                                                      |
| **Review completed**       | 2026-07-02                                              |

> **Auto-update rule:** When new upstream commits are fetched, update `To` to the new
> `upstream/main` HEAD and increment `Total commits reviewed` by the number of truly
> new commits (excluding already-reviewed ones in UPSTREAM_DECISIONS.md).

---

## Summary of Reviewed Work

### Implemented (9 commits — imported 2026-07-02)

| Upstream Hash | Local SHA   | Title                                                         | Category |
| ------------- | ----------- | ------------------------------------------------------------- | -------- |
| `8849f1a00`   | `2490eeb08` | chore: enforce no-floating-promises (#253)                    | Refactor |
| `80fb15906`   | `c99e1e6f4` | ci: improve PR label reconciliation (#228)                    | Build    |
| `67df9f9c6`   | `063405457` | fix(delegation): serialize reopenParentFromDelegation (#725)  | Bug Fix  |
| `9a2e8d866`   | `cd0906b0e` | fix(vscode-lm): reliable auto context condensing (#710)       | Bug Fix  |
| `211d36063`   | `5ef31ba`   | fix(ThinkingBudget): support extended reasoning effort (#774) | Bug Fix  |
| `f845f2aa5`   | `dd2f18a`   | feat: implement Claude Sonnet 5 support (#778)                | Feature  |
| `7476c6794`   | `d0871ec81` | feat(task-lifecycle): task status transition guard (#692)     | Feature  |
| `63dec51c1`   | `9b9a750`   | fix(#689): provider cache reset after settings import (#726)  | Bug Fix  |
| `29c2d2e22`   | `c64bf09`   | fix(gemini): base64 encoding (#776)                           | Bug Fix  |

> All applied cleanly. Commit `9a2e8d866` had conflicts in `vscode-lm.ts` and `useSelectedModel.ts`
> — resolved via `--strategy-option=theirs` + Zoo Code custom work re-applied.

### Commits Awaiting Import (SKIPPED — 18 commits)

These commits have been reviewed but not yet imported. They are ready for cherry-pick when the team decides to proceed.

| Category         | Count | Key Commits                                                                                                            |
| ---------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| **Bug Fixes**    | 6     | Delegation race condition (#691), LiteLLM cache collision (#647), shell type guard (#687), Gemma reasoning tags (#324) |
| **Features**     | 2     | Completion change actions (#633), rules management UI (#657)                                                           |
| **Dependencies** | 11    | Anthropic SDK 0.104.1 (#600), AI SDK batch (#744), build tooling (#745), individual dep bumps                          |
| **Docs**         | 1     | Apply_diff prompt enhancement (#619)                                                                                   |

### Permanently Ignored (IGNORED — 1 commit)

| Commit                                                              | Reason                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `1b26b6a69` — fix(diff-view): make auto-closing edited files opt-in | Zoo Code intentionally keeps the current UX. This change must NEVER be suggested again unless explicitly requested. |

> **Auto-update rule:** IGNORED commits are PERMANENT. Never change their status.
> Never re-suggest them. They are excluded from all future reviews automatically.

### Deferred (SKIPPED — 1 commit, handled outside normal import)

| Commit                                       | Reason                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `6705e67fd` — chore: prepare v3.64.0 release | Release preparation is handled manually before releases. Version bumps conflict with our own versioning. |

> `80fb15906` (CI) was previously deferred but imported 2026-07-02.

---

## Automatic Workflow for Upstream Integration

**Every future agent MUST follow this exact sequence when working on upstream integration.
No user instruction is required — this workflow is self-triggering.**

### Phase 1: Read Current State (ALWAYS FIRST)

```
1. Read .upstream/STATE.json          → lastFetchedCommit, reviewedCommits[], lastSyncCommit
2. Read .upstream/IMPLEMENTATION_STATE.md  → Current status overview (this file)
3. Read .upstream/UPSTREAM_DECISIONS.md    → All prior decisions with reasons
```

### Phase 2: Fetch & Filter (When reviewing new upstream)

```
1. git fetch upstream
2. git log --oneline <lastFetchedCommit>..upstream/main
3. For each commit hash in the log:
   a. Search UPSTREAM_DECISIONS.md for the hash
   b. If found with ANY status → SKIP (already reviewed)
   c. If NOT found → it's truly new, needs review
4. Present only truly new commits for review
```

### Phase 3: Implement (When cherry-picking)

```
1. git cherry-pick <commit-sha>
2. If SUCCESS:
   a. STATE.json:    Change hash status from SKIPPED → IMPLEMENTED
   b. STATE.json:    Update lastSyncCommit, lastSyncAt, lastSyncMessage
   c. UPSTREAM_DECISIONS.md: Change Status line to IMPLEMENTED, add Imported date
   d. IMPLEMENTATION_STATE.md: Move commit from "Awaiting Import" to "Implemented", update counts
3. If FAILURE:
   a. Keep status as SKIPPED in all files
   b. Note the failure in UPSTREAM_DECISIONS.md
   c. git cherry-pick --abort (if needed)
4. Verify all three files agree (cross-file consistency check)
```

### Phase 4: New Review (When new commits exist upstream)

```
1. Update STATE.json: lastFetchedCommit → new upstream/main HEAD
2. For each truly new commit:
   a. Add entry to STATE.json reviewedCommits[]
   b. Add entry to UPSTREAM_DECISIONS.md with decision
3. Update IMPLEMENTATION_STATE.md summaries
4. Update review window dates
```

---

## File Reference

| File                      | Purpose                         | Auto-updated?                         |
| ------------------------- | ------------------------------- | ------------------------------------- |
| `STATE.json`              | Machine-readable tracking state | ✅ Yes — on every integration event   |
| `IMPLEMENTATION_STATE.md` | Human-readable status overview  | ✅ Yes — on every integration event   |
| `UPSTREAM_DECISIONS.md`   | Permanent decision log          | ✅ Yes — on every review/integration  |
| `COMMITS.md`              | Legacy log format (superseded)  | ❌ No — kept for historical reference |

---

## Anti-Duplicate Guarantee

This system ensures **no commit is ever reviewed twice**:

- **IMPLEMENTED** commits: Already in our codebase. Automatically excluded.
- **IGNORED** commits: Permanently rejected with documented reason. Must NEVER be re-suggested.
- **SKIPPED** commits: Reviewed but not yet imported. Listed for potential future import but not re-reviewed.

The only commits that should ever appear in a new upstream review are those whose hash does NOT appear in `UPSTREAM_DECISIONS.md`.
