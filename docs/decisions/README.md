# 🏛️ Architecture Decision Records (ADRs)

> Every significant architectural or design decision is recorded here.
> Future contributors can understand WHY things were built the way they were.

---

## What is an ADR?

An Architecture Decision Record documents:

- The **context** (situation forcing a decision)
- The **decision** made
- The **alternatives** considered
- The **consequences** (trade-offs accepted)

This prevents re-litigating old decisions and helps new contributors understand the codebase.

---

## ADR Template

```markdown
# ADR-NNN: <Short Title>

Date: YYYY-MM-DD
Status: Proposed | Accepted | Deprecated | Superseded by ADR-NNN
Author: <name>

## Context

What situation or problem forced this decision?

## Decision

What was decided?

## Alternatives Considered

1. **Option A** — pros / cons
2. **Option B** — pros / cons
3. **Option C** (chosen) — why this one

## Consequences

### Positive

- ...

### Negative / Trade-offs

- ...

### Neutral

- ...
```

---

## ADR Index

| #                                                              | Title                                      | Status   | Date       |
| -------------------------------------------------------------- | ------------------------------------------ | -------- | ---------- |
| [ADR-001](ADR-001-settings-view-cached-state.md)               | SettingsView uses cached state buffer      | Accepted | pre-fork   |
| [ADR-002](ADR-002-monorepo-turborepo.md)                       | Monorepo with Turborepo + pnpm             | Accepted | pre-fork   |
| [ADR-003](ADR-003-types-build-first.md)                        | @roo-code/types builds before all packages | Accepted | pre-fork   |
| [ADR-004](ADR-004-upstream-sync-system.md)                     | Selective upstream cherry-pick sync        | Accepted | 2026-06-24 |
| [ADR-005](ADR-005-integration-branch-and-forbidden-systems.md) | Integration branch + Deep Sequential ban   | Accepted | 2026-07-19 |
