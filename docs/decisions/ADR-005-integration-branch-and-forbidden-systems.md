# ADR-005: Integration Branch + Forbidden Systems Policy

**Date:** 2026-07-19  
**Status:** Accepted  
**Author:** maintainers (fork)

## Context

The fork accumulated multiple long-lived feature branches. Agents and developers
could not tell which branch was “latest,” and a large feature branch mixed
**workers multi-agent** with an experimental **Deep Sequential Agentic Pipeline**.

We also need a permanent rule so agents do not re-introduce removed systems, and
a clear process to pull **selected** updates from `Zoo-Code-Org/Zoo-Code` while
recording **which upstream commit was last reviewed/imported**.

## Decision

### 1. Canonical development branch = `integration`

| Branch                        | Role                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `main`                        | Default / release-oriented; no direct agent drive-by pushes                         |
| **`integration`**             | **Only** day-to-day development branch for agents, workers, and new VS Code windows |
| short-lived `feat/*`, `fix/*` | Created **from `integration`**, merged back via PR to `integration` only            |

**Every agent must start with:**

```bash
git fetch origin
git switch integration
git pull
```

### 2. Forbidden to re-add (permanent unless new ADR supersedes this)

The following must **not** be reintroduced on `integration` or any PR into it:

- `src/core/pipeline/**` (Deep Sequential Agentic Pipeline)
- Settings / state `agenticMode` with value `deepSequential`
- Pipeline StageBar / pipeline approval gates / pipeline-only telemetry bridges
- Feature flags that re-enable Deep Sequential without an explicit new ADR

**Allowed (and required to keep):**

- Classic workers multi-agent: `src/core/orchestration/**`, `spawn_worker`, inbox tools
- Classic serial subtask: `new_task` (parent/child stack) — this is **not** Deep Sequential

### 3. Upstream updates = selective cherry-pick only (existing system)

Use the existing Upstream Sync System (ADR-004):

| Command                             | Purpose                                                               |
| ----------------------------------- | --------------------------------------------------------------------- |
| `pnpm upstream:check`               | Fetch upstream; record **last fetched** SHA in `.upstream/STATE.json` |
| `pnpm upstream:import <sha>`        | Cherry-pick **one** wanted commit; mark IMPORTED                      |
| `pnpm upstream:skip <sha> "reason"` | Record deliberate skip                                                |

**NEVER** `git merge upstream/main`.

Tracking files (committed to the repo / GitHub):

- `.upstream/STATE.json` — `lastFetchedCommit`, `lastSyncCommit`, reviewed list
- `.upstream/COMMITS.md` / `UPSTREAM_DECISIONS.md` / `IMPLEMENTATION_STATE.md` — human logs

### 4. How agents prove they are not re-adding sequential

Before finishing any multi-file agentic work, agents must confirm:

```text
src/core/pipeline does not exist
no deepSequential / PipelineController in source
src/core/orchestration still exists if workers were not intentionally removed
```

## Consequences

### Positive

- One obvious branch for all ongoing work
- Sequential cannot “quietly” return without violating ADR
- Upstream history of **last check / last import** stays on GitHub

### Negative

- Agents must not invent parallel “latest” feature branches as the home base
- Upstream remains manual (intentional)

## Supersedes / relates

- Complements ADR-002 (PR workflow) and ADR-004 (upstream cherry-pick)
- Supersedes ad-hoc “work on any long-lived feat/\* as default”
