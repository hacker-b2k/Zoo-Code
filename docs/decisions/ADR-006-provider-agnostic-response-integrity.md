# ADR-006: Provider-Agnostic Response Integrity

Date: 2026-07-28
Status: Accepted

## Context

Zoo Code supports many providers with uneven native tool-call behavior. A provider-specific retry or renderer patch would not solve future model deviations. Interactive follow-up UI also needs a safe compatibility path for text-form markup without exposing raw tags. Finally, ordinary chat updates need task-generation identity so a late event cannot appear in the wrong task.

## Decision

1. Keep providers limited to producing the shared `ApiStream`; recover textual calls only in the shared assistant-message layer.
2. Strengthen the provider-neutral retry instruction to forbid plain-text reasoning when an actionable request needs a tool. Cap no-tool retries and terminate with a clear completion/error path rather than looping indefinitely.
3. Introduce a pure, bounded compatibility parser for `<ElicitationsGroup>` / `<Elicitation>` text. Convert recognized groups into the existing validated follow-up payload, preserving the legacy format. Invalid markup produces a safe text fallback rather than raw structural tags.
4. Validate every final follow-up payload at runtime with the shared Zod schema before rendering it.
5. Include task ID and task instance ID on incremental chat events. The webview accepts an incremental event only when it matches the currently loaded task generation; legacy events remain accepted for compatibility.

## Alternatives considered

- **Provider/model-specific patches:** rejected because they do not scale to new gateways and weaken shared behavior.
- **Regex-only permissive XML rendering:** rejected because unbounded parsing can accept malformed/nested input and risks unsafe UI behavior. The compatibility parser is intentionally constrained to self-contained, non-nested elicitation definitions.
- **Mandatory global `tool_choice: required`:** rejected because ordinary conversational turns must not be forced into calls and providers map the setting differently.
- **Timestamp-only message identity:** rejected as timestamps are not strong task-generation correlation.

## Data flow

```text
Provider stream/text -> shared textual recovery -> validated ToolUse or sanitized text
Follow-up text -> validated legacy JSON OR compatible elicitation parser -> FollowUpSuggest
Task incremental update + {taskId, instanceId} -> webview identity gate -> chat state
```

## API and tests

The extension-to-webview protocol adds optional task identity to incremental chat events. Tests cover recovery/sanitization, schema-safe follow-up rendering, and rejection of stale incremental events.
