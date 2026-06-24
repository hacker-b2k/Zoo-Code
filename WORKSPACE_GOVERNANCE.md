# 🔒 Zoo Code Workspace Governance

> **This document is LAW in this workspace. Every agent, developer, and contributor MUST read and follow it before touching a single line of code.**

---

## ⚠️ ABSOLUTE RULES — NON-NEGOTIABLE

### 1. NO SHORTCUTS
- Never use `--no-verify`, `--force`, shallow clones, or any flag that bypasses safety checks unless explicitly documented and approved.
- Never skip tests, type checks, or linting.
- Never comment out failing tests to make CI pass.
- Never use `any` in TypeScript unless it is the ONLY option and is explicitly justified in a comment.
- Never hardcode values that belong in config or constants.

### 2. NO CHEATING
- Do not fabricate test results. Run them. Report what actually happened.
- Do not claim a task is done if verification was not performed.
- Do not skip LFS files, binary assets, or large files because they are inconvenient.
- Do not fake file counts, hashes, or comparison results.
- Every claim must be provable. Every action must be verifiable.

### 3. PLAN FIRST — ALWAYS
- **Zero code changes without a written plan.** See `PLANNING_REQUIRED.md`.
- Every feature, fix, or refactor starts with: Research → Design → Plan → Review → Execute.
- No one-line "quick fixes" without understanding the full impact.

### 4. NO HALF-WORK
- A task is not done until it is verified end-to-end.
- No "I'll fix it later." Fix it now or do not do it.
- Every PR must be complete: code + tests + docs update if needed.

### 5. INDUSTRY STANDARD QUALITY
- Code must be production-grade. No placeholder logic, no TODO-driven development in final output.
- All TypeScript must be strictly typed.
- All new modules must have unit tests.
- All public APIs must be documented.

---

## 📋 PRE-CHANGE CHECKLIST

Before making ANY change to this codebase, answer ALL of these:

- [ ] Have I read `ARCHITECTURE.md` and understand the affected modules?
- [ ] Have I read `REQUIREMENTS.md` for the current task scope?
- [ ] Have I written a plan in `docs/plans/` (from `PLANNING_REQUIRED.md`)?
- [ ] Have I identified all files that will be affected?
- [ ] Have I checked for existing tests that cover this area?
- [ ] Have I verified the change does not break existing functionality?
- [ ] Have I run `pnpm check-types` before submitting?
- [ ] Have I run `pnpm test` before submitting?
- [ ] Have I run `pnpm lint` before submitting?

---

## 🛠️ TECH STACK (READ BEFORE CODING)

| Layer | Tech |
|---|---|
| Language | TypeScript 5.8 (strict) |
| Runtime | Node.js 20.20.2 |
| Package manager | pnpm 10.8.1 |
| Monorepo | Turborepo 2.9 |
| Extension host | VS Code Extension API |
| Frontend | React 18 + Vite 8 |
| Testing | Vitest (unit) + Playwright (e2e) |
| Linting | ESLint 9 |
| Formatting | Prettier 3.5 |
| Build | esbuild 0.28 (extension) + Vite (webview) |

---

## 📁 WHERE THINGS LIVE

```
src/                    ← VS Code Extension (main package)
  extension.ts          ← Activation entry point
  core/                 ← AI task engine, tools, prompts, context
  api/                  ← AI provider integrations (50+)
  services/             ← MCP, code-index, tree-sitter, ripgrep, etc.
  integrations/         ← terminal, editor, browser, diagnostics
  activate/             ← Command/action registration
  shared/               ← Shared utilities across extension
  utils/                ← Pure utility functions

webview-ui/             ← React sidebar UI
  src/components/       ← All UI components
  src/context/          ← Extension state context
  src/hooks/            ← Custom React hooks

packages/               ← Internal shared libraries
  @roo-code/types       ← Shared types (build first!)
  @roo-code/core        ← Shared AI engine logic
  @roo-code/cloud       ← Zoo Code Cloud service
  @roo-code/telemetry   ← Analytics (PostHog)
  @roo-code/ipc         ← Extension ↔ Webview message contracts

apps/
  vscode-e2e/           ← End-to-end tests
  vscode-nightly/       ← Nightly build configuration

docs/                   ← All planning, research, decisions (our addition)
  plans/                ← Per-task implementation plans
  research/             ← Research notes
  decisions/            ← Architecture Decision Records (ADRs)
```

---

## 🔄 BUILD COMMANDS

```bash
pnpm install            # Install all dependencies
pnpm build              # Build all packages
pnpm test               # Run all tests
pnpm check-types        # TypeScript type check
pnpm lint               # ESLint check
pnpm format             # Prettier format
pnpm vsix               # Build .vsix extension package
pnpm clean              # Clean all build artifacts
```

---

## 🚦 BRANCH STRATEGY

- `main` — stable, always passing CI
- `feature/<name>` — new features
- `fix/<name>` — bug fixes
- `refactor/<name>` — refactoring
- `docs/<name>` — documentation only

Never push directly to `main`. Always use a branch + PR.

---

## 📝 COMMIT MESSAGE FORMAT

```
type(scope): short description

Types: feat | fix | refactor | test | docs | chore | perf | style
Scope: core | api | ui | services | integrations | build | deps

Examples:
  feat(core): add parallel tool execution support
  fix(api): handle claude rate limit with exponential backoff
  refactor(services/mcp): extract connection pooling to separate class
```

---

*Last updated: 2026-06-24 | Maintainer: hacker-b2k (Zoo Code fork)*
