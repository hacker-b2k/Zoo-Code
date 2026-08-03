# 📋 Requirements — Zoo Code Workspace

> This document captures the user's standing requirements for ALL work done in this workspace.
> Every task must align with these. Read before planning anything.

---

## 🎯 Prime Directive

**Build only professional, industry-grade results. No limitations. No shortcuts. No cheating.**

This is the foundation. Everything below serves this directive.

---

## Standing Requirements (Apply to Every Task)

### R1 — Quality Over Speed
- Production-grade code only. No prototypes shipped as final.
- If it takes longer to do it right, take longer.
- Polished, complete, tested, documented.

### R2 — Risk-Proportionate Planning
- Assess each change's scope, risk, reversibility, and complexity (see `PLANNING_REQUIRED.md`).
- Trivial, low-risk changes may use a brief checklist; substantial or high-risk work requires written research, design, planning, and review proportionate to its impact.
- The virtual Spec Workspace is canonical for agent-created plans. Repository planning documents are created only when explicitly requested or required as durable project records.
- Do not provide effort or elapsed-time estimates unless the user or maintainer explicitly requests them.

### R3 — No Shortcuts That Create Limitations
- No skipping affected files or relevant validation and verification; select checks proportionate to scope and risk.
- No `any` types, no suppressed errors, no disabled lint rules without justification.
- No bypassing safety mechanisms (force push, no-verify, shallow clone) unless documented + approved.

### R4 — No Cheating
- All results must be real and verifiable.
- Run tests, report actual output.
- Verify file integrity with hashes when relevant.
- Never claim completion without proof.

### R5 — Full Understanding Before Action
- Read all affected code before modifying it.
- Understand the data flow, dependencies, and side effects.
- Match existing patterns and conventions in the codebase.

### R6 — Complete Verification
- After every change, run the targeted type checks, tests, lint, and other validation applicable to the affected scope and risk.
- Manual verification of functional/visual behavior where applicable.
- Clean up any temporary files created during work.

### R7 — Preserve Repo Integrity
- Keep the local clone identical to upstream where unmodified.
- Track changes deliberately; never lose files or history.
- LFS files and binaries must be present and verified, never skipped.

---

## Project-Specific Requirements

### PR1 — Stay Compatible with Upstream
- This is a fork of `Zoo-Code-Org/Zoo-Code`.
- Keep `upstream` remote configured for syncing.
- Understand that changes may need to merge with upstream updates.

### PR2 — Respect the Monorepo
- Honor the Turborepo build order (`@roo-code/types` first).
- Use pnpm workspace protocols for internal dependencies.
- Never break the build graph.

### PR3 — Honor AGENTS.md Constraints
- SettingsView state isolation pattern (cachedState, not live state).
- No per-commit `.changeset` files.
- Follow the test placement guidance (test pyramid).

### PR4 — Multi-Provider Integrity
- The extension supports 50+ AI providers. Changes to the API layer must not break existing providers.
- New providers follow the full integration checklist (see `ARCHITECTURE.md`).

### PR5 — i18n Awareness
- UI strings are translated into 17+ languages.
- New user-facing strings must use the i18n system, not hardcoded text.

---

## Definition of Done (Every Task)

A task is DONE only when all applicable items are true:

- [ ] Planning matched the change's risk and complexity and was followed
- [ ] Code is complete (no TODOs, no placeholders in final output)
- [ ] New logic has appropriate tests
- [ ] Targeted type checks, tests, and lint pass where applicable
- [ ] Manual verification was performed and documented where applicable
- [ ] Docs were updated if behavior/API changed
- [ ] No temporary files were left behind
- [ ] Changes target `integration`, directly or through a short-lived branch and PR, with a clear message

---

## What "No Limitations" Means

- We do not avoid hard problems because they are hard.
- We do not pick the easy 80% solution and leave the hard 20%.
- We do not skip edge cases.
- We do not cut corners on error handling, security, or performance.
- We find a way through every obstacle using all available tools.

---

*Requirements set by: workspace owner (hacker-b2k)*
*Last updated: 2026-08-02*
