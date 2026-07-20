# Branch & Upstream Policy (Fork Official)

**Last updated:** 2026-07-19  
**Canonical branch:** `integration`  
**Upstream org:** [Zoo-Code-Org/Zoo-Code](https://github.com/Zoo-Code-Org/Zoo-Code)  
**Our fork:** [hacker-b2k/Zoo-Code](https://github.com/hacker-b2k/Zoo-Code)

---

## 1. Why this exists

Without a single official branch, agents pick random `feat/*` branches, reintroduce
deleted systems, and lose track of which upstream commits were already reviewed.

This document is the **official rulebook** for:

1. Which branches we keep and how we work
2. How we download upstream updates **selectively**
3. Where we record **last fetched / last imported** commits
4. What must never come back (Deep Sequential)

---

## 2. Branch model (our marzi / official set)

```
upstream/main   (Zoo-Code-Org)     ← read-only source of optional updates
       │
       │  cherry-pick only (never merge)
       ▼
origin/integration   ◄── YOU WORK HERE (agents + humans)
       │
       ├── PR ← feat/short-name   (created from integration)
       ├── PR ← fix/short-name
       └── (optional) main ← release PR from integration when ready
```

| Branch                                                       | Keep?               | Purpose                                                 |
| ------------------------------------------------------------ | ------------------- | ------------------------------------------------------- |
| **`integration`**                                            | **YES — home base** | All ongoing product work                                |
| `main`                                                       | YES                 | Default / release alignment; not the daily agent branch |
| short `feat/*` / `fix/*`                                     | Temporary           | Branch from `integration`, PR back, then delete         |
| Long-lived mixed bag branches (e.g. old multi-feature feats) | **No as home base** | Prefer delete after contents live on `integration`      |
| Renovate / bot branches                                      | Optional            | Review case-by-case; never set as default               |

### Daily start (mandatory for agents)

```bash
git fetch origin
git switch integration
git pull
```

### New work

```bash
git switch integration
git pull
git switch -c feat/my-change
# ... work ...
# open PR → integration (not random other branches)
```

---

## 3. Forbidden systems (agents cannot re-add)

See **ADR-005**.

| System                                                           | Status on `integration`           |
| ---------------------------------------------------------------- | --------------------------------- |
| Workers multi-agent (`src/core/orchestration`, `spawn_worker`)   | **Allowed / kept**                |
| `new_task` serial child tasks                                    | **Allowed** (not Deep Sequential) |
| Deep Sequential pipeline (`src/core/pipeline`, `deepSequential`) | **Forbidden**                     |

If an agent re-adds `src/core/pipeline` or `agenticMode: deepSequential` without a new
accepted ADR, that change must be rejected in review.

---

## 4. Upstream updates (download only what we want)

We already have tooling. Use it; do not invent a second process.

### Commands

```bash
# 1) See what is new on Zoo-Code-Org (updates lastFetched* in STATE.json)
pnpm upstream:check

# 2) Take one commit you want (cherry-pick + mark IMPORTED)
pnpm upstream:import <sha>

# 3) Explicitly skip one commit (mark SKIPPED with reason)
pnpm upstream:skip <sha> "reason here"
```

### Where “last commit we downloaded / reviewed” is recorded

| Field / file                                                | Meaning                                                |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `.upstream/STATE.json` → **`lastFetchedCommit`**            | Last upstream HEAD we **checked**                      |
| `.upstream/STATE.json` → **`lastSyncCommit`**               | Last commit we **successfully imported** (cherry-pick) |
| `.upstream/STATE.json` → **`lastFetchedAt` / `lastSyncAt`** | When                                                   |
| `.upstream/COMMITS.md` + `UPSTREAM_DECISIONS.md`            | Human-readable history of decisions                    |

**After check/import/skip, commit `.upstream/*` to `integration` and push** so the
record lives on GitHub (not only on one machine).

### Hard ban

```text
NEVER: git merge upstream/main
ALWAYS: selective cherry-pick via upstream:import
```

---

## 5. How this stops confusion

| Problem                               | Rule                               |
| ------------------------------------- | ---------------------------------- |
| “Which branch is latest?”             | Always **`integration`**           |
| “Can agent re-add sequential?”        | **No** — ADR-005 + this doc        |
| “Did we already take upstream fix X?” | Look at **`.upstream/STATE.json`** |
| “What did we last fetch?”             | **`lastFetchedCommit`**            |
| “What did we last import?”            | **`lastSyncCommit`**               |

---

## 6. Cleanup recommendations (manual)

When you are ready (not automatic):

1. Confirm product on `integration` is good
2. Delete remote long-lived bags that only existed to hold mixed work, e.g.  
   `origin/feat/multi-agent-orchestration-and-manage-tools`  
   (its sequential tip must **not** be re-merged)
3. Keep `integration` as the only agent default

---

## Related docs

- [ADR-004 Upstream Sync](decisions/ADR-004-upstream-sync-system.md)
- [ADR-005 Integration + Forbidden Systems](decisions/ADR-005-integration-branch-and-forbidden-systems.md)
- [Upstream sync how-to](upstream-sync/README.md)
- [AGENTS.md](../AGENTS.md) — agent start rules
