# 📐 Planning Required — Scale Planning to the Change

> **RULE: Plan in proportion to risk and complexity.**
>
> Every task requires deliberate scope and verification, but trivial changes do not require a universal five-stage document pipeline.

---

## Choose the Planning Level

Assess blast radius, complexity, reversibility, uncertainty, security/privacy impact, data or API compatibility, and cross-module dependencies.

### Level 1 — Trivial / Low Risk

Use a brief task checklist or equivalent working notes. Examples include typo corrections, narrow documentation cleanup, formatting-only changes, and obvious localized fixes with no behavioral uncertainty.

Required:

- Identify the intended change and affected files.
- Preserve unrelated content.
- Run targeted verification appropriate to the change.

### Level 2 — Standard

Use a concise implementation plan for bounded features, fixes, or refactors with understood dependencies and moderate blast radius.

Required:

- Confirm current behavior and relevant existing patterns.
- Record scope, implementation steps, risks, and verification.
- Review the plan before execution and update it if discoveries materially change scope.

### Level 3 — High Risk / Architectural

Use the full workflow for architectural changes, migrations, security-sensitive work, broad refactors, cross-package contracts, difficult-to-reverse changes, or work with significant uncertainty:

```
1. RESEARCH  →  2. DESIGN  →  3. PLAN  →  4. REVIEW  →  5. EXECUTE
```

Required:

- Document current behavior, constraints, dependencies, alternatives, and failure modes.
- Define the proposed design, affected interfaces, compatibility implications, and test strategy.
- Produce a stepwise implementation and rollback plan.
- Obtain the level of review required by the task or maintainers before execution.

---

## Canonical Location for Agent-Created Plans

The **virtual Spec Workspace** is canonical for agent-created requirements, designs, and implementation plans. Use its requirements, design, and tasks documents as appropriate.

Do **not** create repository planning Markdown by default. Create or update a repository document under `docs/research/`, `docs/plans/`, or `docs/decisions/` only when:

- the user or maintainer explicitly requests a repository-visible artifact or path;
- the artifact is intended for version control, contributor review, release evidence, or long-term project history; or
- repository policy requires an ADR or another durable record for the decision.

When a repository artifact is required, keep it consistent with the canonical Spec Workspace while work is active. Accepted ADRs and other explicitly versioned records remain authoritative repository history for their subject.

---

## Research Guidance

For Level 2 or Level 3 work, answer the relevant questions in the virtual Spec Workspace or an explicitly requested repository research document:

- What is the exact problem or feature being addressed?
- What existing code is involved?
- What does the current behavior look like?
- What constraints apply, including performance, compatibility, API limits, or bundle size?
- Which existing codebase patterns should be followed?
- What could go wrong?

Depth matters; elapsed time does not. Do not impose or promise minimum planning durations.

---

## Design Guidance

For Level 3 work, capture:

- Proposed solution and rationale
- Alternative approaches considered and why they were rejected
- Data flow or sequence diagram if applicable
- API surface and types/interfaces affected
- Compatibility, migration, rollback, and test strategy

Create an ADR in `docs/decisions/` only when the decision needs an explicitly versioned, durable architectural record.

---

## Implementation Plan Template

Use the virtual Spec Workspace tasks document by default. If a repository plan is explicitly required, this template may be used at the requested path:

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
- [ ] Step 1 — description
- [ ] Step 2 — description
- [ ] Step 3 — description

## Verification
- [ ] Targeted type checks, tests, and lint selected for the affected scope
- [ ] Manual test: [describe what to verify visually/functionally, if applicable]

## Risks
- Risk 1: [mitigation]
- Risk 2: [mitigation]

## Dependencies
- Depends on: [other tasks/PRs]
- Blocks: [other tasks/PRs]
```

Do not add effort or elapsed-time estimates unless the user or maintainer explicitly requests them. Prefer scope, dependencies, risks, and observable acceptance criteria.

---

## Review and Execution

Before executing a Level 2 or Level 3 plan, review it at a depth proportionate to risk:

- Does the plan cover relevant edge cases?
- Is there a simpler approach that achieves the same result?
- Does this break existing behavior or compatibility?
- Is the scope focused on the requested outcome?
- Is rollback or recovery defined where needed?

During execution:

- Make one logical change at a time.
- Run targeted checks after significant changes.
- Never leave the codebase in a broken state between steps.
- If a discovery materially changes scope or risk, stop and update the plan before continuing.

---

## Verification Is Always Required

The amount of planning varies; honest verification does not. Select checks that prove the requested change without imposing unrelated work. Report what actually ran and do not claim success without evidence.

---

*This document applies to all contributors, human and AI agents alike. Last updated: 2026-08-02.*
