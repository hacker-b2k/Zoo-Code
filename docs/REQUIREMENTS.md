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

### R2 — Mandatory Planning
- Every change starts with research + design + plan (see `PLANNING_REQUIRED.md`).
- No code before the plan is written and reviewed.

### R3 — No Shortcuts That Create Limitations
- No skipping files, tests, validation, or verification.
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
- After every change: type check + tests + lint must pass.
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

A task is DONE only when ALL of these are true:

- [ ] Plan was written and followed
- [ ] Code is complete (no TODOs, no placeholders in final output)
- [ ] All new logic has unit tests
- [ ] `pnpm check-types` passes
- [ ] `pnpm test` passes (relevant suites)
- [ ] `pnpm lint` passes
- [ ] Manual verification performed and documented
- [ ] Docs updated if behavior/API changed
- [ ] No temporary files left behind
- [ ] Changes are committed on a proper branch with a clear message

---

## What "No Limitations" Means

- We do not avoid hard problems because they are hard.
- We do not pick the easy 80% solution and leave the hard 20%.
- We do not skip edge cases.
- We do not cut corners on error handling, security, or performance.
- We find a way through every obstacle using all available tools.

---

*Requirements set by: workspace owner (hacker-b2k)*
*Last updated: 2026-06-24*
