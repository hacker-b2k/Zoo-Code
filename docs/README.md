# 📚 Zoo Code Workspace Documentation

> Central index for all workspace governance, planning, and reference docs.

---

## 🔒 Governance (Read These First)

| Document                                                   | Purpose                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`../WORKSPACE_GOVERNANCE.md`](../WORKSPACE_GOVERNANCE.md) | **The law.** No shortcuts, no cheating, and planning proportionate to risk.             |
| [`../PLANNING_REQUIRED.md`](../PLANNING_REQUIRED.md)       | Risk/complexity planning levels and canonical virtual Spec Workspace policy.            |
| [`REQUIREMENTS.md`](REQUIREMENTS.md)                       | Standing requirements that apply to every task.                                         |

---

## 🏛️ Reference

| Document                                                         | Purpose                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)                             | Deep technical architecture of the extension.                  |
| [`DEV_SETUP.md`](DEV_SETUP.md)                                   | Zero-to-running dev environment guide.                         |
| [`BRANCH_AND_UPSTREAM_POLICY.md`](BRANCH_AND_UPSTREAM_POLICY.md) | **Official branch model + forbidden systems + upstream rules** |
| [`MARKETPLACE_PUBLISH.md`](MARKETPLACE_PUBLISH.md)               | Fix/setup VSCE_PAT + pre-release/stable marketplace publish    |

---

## 🔄 Upstream Sync

| Document                                                                                                                         | Purpose                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [`upstream-sync/README.md`](upstream-sync/README.md)                                                                             | Track, review & selectively import upstream changes            |
| [`BRANCH_AND_UPSTREAM_POLICY.md`](BRANCH_AND_UPSTREAM_POLICY.md)                                                                 | Canonical branch = `integration`; never re-add Deep Sequential |
| [`../.upstream/STATE.json`](../.upstream/STATE.json)                                                                             | **`lastFetchedCommit` / `lastSyncCommit`** (lives on GitHub)   |
| [`../.upstream/COMMITS.md`](../.upstream/COMMITS.md)                                                                             | Human-readable commit log                                      |
| [`decisions/ADR-005-integration-branch-and-forbidden-systems.md`](decisions/ADR-005-integration-branch-and-forbidden-systems.md) | ADR: integration + ban Deep Sequential                         |

**Commands**: `pnpm upstream:check` | `pnpm upstream:import <sha>` | `pnpm upstream:skip <sha> "<reason>"`
**Never**: `git merge upstream/main`

---

## 📋 Planning and Durable Records

The virtual Spec Workspace is canonical for agent-created requirements, designs, and implementation plans. Repository documents are conditional: create them only when a maintainer or task explicitly requests a versioned artifact, or when an ADR/durable project record is required.

| Folder                     | Purpose                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- |
| [`research/`](research/)   | Explicitly requested, repository-visible research records.                       |
| [`plans/`](plans/)         | Explicitly requested, repository-visible implementation plans.                   |
| [`decisions/`](decisions/) | Architecture Decision Records (ADRs) retained as durable project history.         |

---

## ⚡ The Golden Workflow

```
For any task:

1. Read the relevant governance and requirements.
2. ASSESS    → determine scope, risk, reversibility, and complexity.
3. PLAN      → brief checklist for trivial work; concise plan for standard work;
               full research/design/plan/review for high-risk or architectural work.
4. RECORD    → use the virtual Spec Workspace by default; create repository docs only
               when explicitly requested or required as durable project history.
5. EXECUTE   → follow the selected plan and update it if scope materially changes.
6. VERIFY    → run targeted checks that prove the change.
7. DONE      → only when the applicable Definition of Done is met.
```

---

## 🎯 Core Principles (Memorize)

1. **No shortcuts** that create limitations.
2. **No cheating** — every claim is verifiable.
3. **Plan proportionately** — rigor follows risk and complexity.
4. **Canonical planning home** — agent-created plans live in the virtual Spec Workspace unless a repository artifact is explicitly required.
5. **No unsolicited time estimates** — provide effort or elapsed-time estimates only when explicitly requested.
6. **No half-work** — done means verified end-to-end.
7. **Industry standard** — production-grade only.

---

_This workspace is set up for high-quality, professional, limitation-free engineering._
_Last updated: 2026-08-02_
