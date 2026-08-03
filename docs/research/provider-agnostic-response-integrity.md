# Research: Provider-Agnostic Response Integrity

Date: 2026-07-28

## Problem

Some models emit reasoning or XML-like interaction markup as ordinary text instead of native tool calls. The chat webview currently renders unsupported elicitation markup as raw text, and chat commands/events are not explicitly bound to the task generation that produced them.

## Existing behavior

- `Task.recursivelyMakeClineRequests()` consumes every provider through the common `ApiStream` contract.
- `NativeToolCallParser` normalizes native calls. `TextToolCallParser` and `applyTextualToolCallRecovery()` already recover several textual tool-call formats after a stream completes.
- No `ElicitationsGroup` protocol or renderer exists. `ask_followup_question` currently transports legacy JSON `{ question, suggest }`.
- The webview parses follow-up JSON with a syntax-only parser, so malformed persisted/recovered payloads can reach rendering code unchecked.
- `messageAdded` and `messageUpdated` are matched by timestamp and do not carry task generation identity. Inbound `askResponse`, queue, and cancellation commands are applied to the currently focused task.

## Constraints

- Preserve native provider tool support and use no provider/model special cases.
- Keep backward compatibility for persisted legacy follow-up JSON.
- New UI text must use i18n; protocol fallbacks should reuse existing message content where possible.
- Changes must be strongly typed and covered at the narrowest test layer.

## Risks and mitigations

- Textual tool recovery could execute prose/code samples: only recover recognized tool-call envelopes and continue requiring native tool validation.
- Markup parsing could leak broken XML: parse only complete groups, render a safe text fallback, and remove recognized structural markup from fallback output.
- Stale messages could update a later task: add a task instance identity to incremental events and reject mismatches at the client.
- Protocol changes can affect older webviews: keep new correlation fields optional during rollout and apply strict checks only when a correlation identity is supplied.
