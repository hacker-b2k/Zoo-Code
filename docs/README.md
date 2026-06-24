# 📚 Zoo Code Workspace Documentation

> Central index for all workspace governance, planning, and reference docs.

---

## 🔒 Governance (Read These First)

| Document | Purpose |
|----------|---------|
| [`../WORKSPACE_GOVERNANCE.md`](../WORKSPACE_GOVERNANCE.md) | **The law.** No shortcuts, no cheating, plan first. Read before any work. |
| [`../PLANNING_REQUIRED.md`](../PLANNING_REQUIRED.md) | The mandatory 5-stage pipeline before every change. |
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | Standing requirements that apply to every task. |

---

## 🏛️ Reference

| Document | Purpose |
|----------|---------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Deep technical architecture of the extension. |
| [`DEV_SETUP.md`](DEV_SETUP.md) | Zero-to-running dev environment guide. |

---

## 📋 Living Documents (Updated Per Task)

| Folder | Purpose |
|--------|---------|
| [`research/`](research/) | One research doc per investigation. |
| [`plans/`](plans/) | One implementation plan per task. |
| [`decisions/`](decisions/) | Architecture Decision Records (ADRs). |

---

## ⚡ The Golden Workflow

```
For ANY task:

1. Read WORKSPACE_GOVERNANCE.md + REQUIREMENTS.md
2. RESEARCH  → write docs/research/<topic>.md
3. DESIGN    → write docs/decisions/ADR-NNN if architectural
4. PLAN      → write docs/plans/<task>.md
5. REVIEW    → self-review the plan
6. EXECUTE   → code, following the plan step by step
7. VERIFY    → check-types + test + lint + manual
8. DONE      → only when Definition of Done is fully met
```

---

## 🎯 Core Principles (Memorize)

1. **No shortcuts** that create limitations.
2. **No cheating** — every claim is verifiable.
3. **Plan first** — zero code without a written plan.
4. **No half-work** — done means verified end-to-end.
5. **Industry standard** — production-grade only.

---

*This workspace is set up for high-quality, professional, limitation-free engineering.*
*Last updated: 2026-06-24*
