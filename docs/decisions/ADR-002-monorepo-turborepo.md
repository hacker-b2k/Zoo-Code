# ADR-002: Monorepo with Turborepo + pnpm

Date: pre-fork (documented 2026-06-24)
Status: Accepted
Author: Roo/Zoo Code team (documented by hacker-b2k)

## Context

The Zoo Code project has multiple related packages: the VS Code extension, a React
webview, shared type definitions, cloud service, telemetry, IPC contracts, and config
packages. These all need to share code, be built in the correct order, and be tested
independently.

## Decision

Use a **pnpm workspace monorepo** with **Turborepo** as the task runner/build orchestrator.

- `pnpm` for dependency management (workspace: protocol for internal packages)
- `turbo` for parallel task execution with caching and dependency ordering

## Alternatives Considered

1. **npm workspaces** — Less efficient, no built-in caching. Rejected.
2. **yarn workspaces** — pnpm is faster and more disk-efficient. Rejected.
3. **Nx** — More opinionated, heavier setup. Turborepo is simpler for this use case. Rejected.
4. **pnpm + Turborepo (chosen)** — Industry standard for this scale of project.

## Consequences

### Positive
- Parallel builds with smart caching → faster CI.
- Single `pnpm install` installs everything.
- Internal packages get proper TypeScript type checking.
- Clear dependency graph enforced by Turborepo.

### Negative / Trade-offs
- Exact pnpm version required (`10.8.1`) — enforced by `only-allow`.
- Build order must be maintained (`@roo-code/types` first).
- Slightly more complex initial setup for new contributors.
