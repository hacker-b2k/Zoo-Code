# ADR-001: SettingsView Uses Cached State Buffer

Date: pre-fork (documented 2026-06-24)
Status: Accepted
Author: Roo/Zoo Code team (documented by hacker-b2k)

## Context

The settings UI (`SettingsView.tsx`) allows users to edit many configuration values.
The extension's source of truth for settings is the `ContextProxy`, exposed to the
webview via `useExtensionState()`. If form inputs bind directly to this live state,
every keystroke would propagate to the source of truth, and incoming state updates
from the extension could overwrite the user's in-progress edits — a race condition.

## Decision

`SettingsView` inputs bind to a **local `cachedState`** that acts as an edit buffer.
The cached state is only flushed to the `ContextProxy` source of truth when the user
explicitly clicks **"Save"**.

## Alternatives Considered

1. **Direct binding to `useExtensionState()`** — Simple, but causes race conditions
   when extension pushes state updates mid-edit. Rejected.
2. **Debounced auto-save** — Reduces but does not eliminate races; also makes
   "discard changes" impossible. Rejected.
3. **Local cached buffer + explicit save (chosen)** — Clean isolation, supports
   discard, no races.

## Consequences

### Positive
- No race conditions between user edits and extension state pushes.
- Users can discard unsaved changes.
- Clear save semantics.

### Negative / Trade-offs
- Developers MUST remember to wire new inputs to `cachedState`, not live state.
  This is a common mistake — enforced via AGENTS.md.

### Neutral
- Requires a "dirty state" indicator to show unsaved changes.
