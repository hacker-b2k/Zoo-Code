# 📐 Planning Required — Before Every Change

> **RULE: Zero code without a plan. This is not optional.**
>
> Every task — no matter how small — must go through this pipeline before implementation begins.

---

## The Pipeline (5 Stages, No Skipping)

```
1. RESEARCH  →  2. DESIGN  →  3. PLAN  →  4. REVIEW  →  5. EXECUTE
```

---

## Stage 1: Research

Before writing a single line, answer these questions in `docs/research/<topic>.md`:

- What is the exact problem or feature being addressed?
- What existing code is involved? (Read all affected files fully.)
- What does the current behavior look like? (Run it, test it, observe it.)
- What are the constraints? (Performance, compatibility, API limits, bundle size?)
- What have others done? (Check existing patterns in this codebase first.)
- What could go wrong?

**Minimum time: Do not rush this. A missed dependency here = broken code later.**

---

## Stage 2: Design

Write a design document in `docs/decisions/<ADR-NNN-topic>.md`:

- Proposed solution (with rationale)
- Alternative approaches considered (and why rejected)
- Data flow / sequence diagram if applicable
- API surface changes (if any)
- Types / interfaces affected
- Test strategy

---

## Stage 3: Plan

Create an implementation plan in `docs/plans/<task-name>.md` using this template:

```markdown
# Implementation Plan: <Task Name>
Date: YYYY-MM-DD
Status: Draft | In Progress | Complete

## Objective
One sentence: what does this accomplish?

## Scope
- Files to create: []
- Files to modify: []
- Files to delete: []
- Packages affected: []

## Steps
- [ ] Step 1 — description (estimated: X min)
- [ ] Step 2 — description
- [ ] Step 3 — description
...

## Verification
- [ ] `pnpm check-types` passes
- [ ] `pnpm test` passes (relevant test suites)
- [ ] `pnpm lint` passes
- [ ] Manual test: [describe what to verify visually/functionally]

## Risks
- Risk 1: [mitigation]
- Risk 2: [mitigation]

## Dependencies
- Depends on: [other tasks/PRs]
- Blocks: [other tasks/PRs]
```

---

## Stage 4: Review

Before executing, the plan must be self-reviewed:

- Does this plan cover all edge cases?
- Is there a simpler approach that achieves the same result?
- Does this break any existing behavior?
- Is the scope creep-free? (Only doing what was planned.)

---

## Stage 5: Execute

Only now write code. Follow the plan step by step. Mark steps complete as you go.

**During execution:**
- Make one logical change at a time.
- Run type checks after each significant change.
- Never leave the codebase in a broken state between steps.
- If you discover something that changes the plan → stop, update the plan, then continue.

---

## ⛔ What Happens If You Skip This

- Broken builds that block others
- Regressions in features that seemed unrelated
- Type errors discovered at bundle time, not at dev time
- Wasted hours debugging avoidable issues
- Rejected PRs that require full rewrites

**The plan takes 10 minutes. The bugs it prevents take hours to fix.**

---

*This document applies to ALL contributors: human and AI agents alike.*
