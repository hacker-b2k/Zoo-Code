# ADR-003: @roo-code/types Builds Before All Packages

Date: pre-fork (documented 2026-06-24)
Status: Accepted
Author: Roo/Zoo Code team (documented by hacker-b2k)

## Context

All packages in the monorepo (`@roo-code/core`, `@roo-code/cloud`, `@roo-code/telemetry`,
`@roo-code/ipc`, and the main `src` extension) import shared TypeScript types from
`@roo-code/types`. If `types` is not built first, all other packages fail to compile.

## Decision

`turbo.json` declares an explicit dependency: all `test` and `build` tasks depend on
`@roo-code/types#build`. This guarantees the types package is always built first.

## Consequences

### Positive
- No "module not found" errors for shared types during builds.
- Single source of truth for all shared type definitions.
- Clear ownership: change a shared type in one place.

### Negative / Trade-offs
- Any breaking change to `@roo-code/types` breaks ALL packages simultaneously.
- Developers must rebuild types after changing shared type definitions.
