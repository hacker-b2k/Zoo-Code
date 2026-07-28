# Implementation Plan: Provider-Agnostic Response Integrity
Date: 2026-07-28
Status: In Progress

## Objective
Make tool-use recovery, elicitation rendering, and chat streaming resilient across providers and task generations.

## Scope
- Files to create: none expected beyond required tests.
- Files to modify: shared prompts, task streaming/retry logic, assistant text recovery, follow-up types/parser, chat renderer, webview protocol/context, tests.
- Files to delete: none.
- Packages affected: extension, webview-ui, @roo-code/types.

## Steps
- [x] Research the common provider response path, interaction renderer, and webview lifecycle.
- [x] Design and self-review a provider-neutral recovery and correlation approach.
- [ ] Strengthen no-tool instructions and cap retries with graceful termination.
- [ ] Parse and sanitize compatible elicitation markup; validate final follow-up payloads before rendering.
- [ ] Correlate incremental chat updates to a task generation and reject stale updates.
- [ ] Add focused regression coverage.
- [ ] Run formatting, relevant tests, type checks, lint, and build; inspect and commit to `integration`.

## Verification
- [ ] Relevant `pnpm test` suites pass.
- [ ] `pnpm check-types` passes.
- [ ] `pnpm lint` passes.
- [ ] Build passes.
- [ ] Manual scenario: malformed elicitation tags never render as raw markup; stale task updates do not alter current chat.

## Risks
- Text recovery must not interpret code examples as executable calls; constrain envelope recognition and retain normal tool validation.
- Existing persisted messages lack correlation fields; treat absent fields as legacy while enforcing supplied identities.

## Dependencies
- Depends on: existing shared `ApiStream`, textual tool recovery, and follow-up JSON format.
- Blocks: none.
