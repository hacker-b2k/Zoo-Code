# ADR-004: Upstream Sync System — Selective Cherry-Pick Workflow

## Status

Accepted (2026-06-24)

## Context

Our fork (`hacker-b2k/Zoo-Code`) tracks `Zoo-Code-Org/Zoo-Code` (original repo).
We need a system to:

1. Know exactly which upstream commits we've last fetched
2. Review upstream changes selectively — only import what we want
3. Store tracking data **online (committed to repo)**, not in local files
4. Keep a decision log of what was imported, skipped, and why

A simple `git merge upstream/main` is not suitable because:
- We don't want ALL upstream changes
- We want to cherry-pick specific features/fixes
- We need audit trail of decisions

## Decision

Create a **`.upstream/` directory** (checked into repo) with:

| File | Purpose |
|------|---------|
| `.upstream/STATE.json` | Machine-readable state — last fetched SHA, pending/imported/skipped lists |
| `.upstream/COMMITS.md` | Human-readable log (auto-generated) |

Plus **3 PowerShell scripts** in `scripts/`:

| Script | Purpose | Works Offline? |
|--------|---------|----------------|
| `upstream-check.ps1` | Fetch upstream, list new commits, store in STATE.json | No (needs fetch) |
| `upstream-import.ps1` | Cherry-pick a specific commit, mark as imported | Yes |
| `upstream-skip.ps1` | Mark a commit as skipped with reason | Yes |

Plus **pnpm scripts** for convenience:

```json
"upstream:check": "powershell scripts/upstream-check.ps1",
"upstream:import": "powershell scripts/upstream-import.ps1",
"upstream:skip": "powershell scripts/upstream-skip.ps1"
```

## Workflow

```
1. pnpm upstream:check
   → Fetches upstream, shows new commits, updates STATE.json

2. Review the commits
   → Decide which ones we want

3. For each wanted commit:
   pnpm upstream:import <sha>
   → Cherry-picks into our branch, marks as IMPORTED

   For each unwanted commit:
   pnpm upstream:skip <sha> "<reason>"
   → No code change, just marks as SKIPPED

4. git push
   → STATE.json is committed — tracking data lives on GitHub!
```

## Consequences

### Positive
- ✅ Full audit trail of upstream sync decisions
- ✅ Data lives in repo — survives local delete, accessible from any machine
- ✅ No accidental `git merge upstream/main` disasters
- ✅ Clear status: IMPORTED / SKIPPED / PENDING

### Negative
- ❌ Manual review required for each batch of upstream changes
- ❌ Cherry-pick conflicts must be resolved manually
- ✅ (Intentional — selective sync is the whole point)

## Alternatives Considered

1. **GitHub Actions automated merge**: Would defeat selective cherry-pick goal
2. **Subtree merge**: Harder to track individual decisions
3. **Local only (git notes)**: Wouldn't survive clone; not visible online
