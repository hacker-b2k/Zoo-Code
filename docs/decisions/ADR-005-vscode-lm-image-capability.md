# ADR-005: VS Code LM Image Capability Detection

## Status

Accepted (2026-06-27)

## Context

Zoo Code supports the VS Code Language Model API provider. VS Code LM models can expose custom endpoints and provider-specific metadata. Some of these models support image input in native VS Code Chat, but Zoo Code can treat them as text-only.

The current capability mapper in `src/api/providers/vscode-lm.ts` only recognizes:

- `model.capabilities.imageInput`
- `model.capabilities.vision`
- static family metadata in `vscodeLlmModels`

When none of those are present, it sets `supportsImages` to `false`. For image-capable custom endpoint models, this false value propagates into task request generation, where image blocks are removed before the VS Code LM request is built.

## Decision

1. Broaden VS Code LM capability detection to recognize additional image/vision metadata shapes exposed by VS Code LM providers.
2. Keep explicit negative capability metadata authoritative when a model clearly reports image support is disabled.
3. Use safe fallback behavior for unknown custom VS Code LM models so Zoo Code does not strip images before the VS Code LM API can accept or reject them.
4. Preserve full VS Code LM model identity in the webview model picker by using `id` when available instead of only `${vendor}/${family}`.
5. Add regression coverage for:
    - provider image capability mapping,
    - image blocks reaching `LanguageModelDataPart` in the final VS Code LM request,
    - selected model capability propagation in the webview.

## Consequences

### Positive

- Image-capable VS Code LM custom endpoint models are no longer downgraded to text-only inside Zoo Code.
- Images survive the task request pipeline and can be converted to `LanguageModelDataPart`.
- Model selection is less prone to collisions when multiple VS Code LM models share vendor/family.

### Negative

- Unknown VS Code LM custom models may show image UI even if the provider later rejects images. This is preferable to silently dropping user images before the API request because VS Code LM is the source of truth for request acceptance.

## Alternatives Considered

1. **Only support `capabilities.imageInput` and `capabilities.vision`**: rejected because it fails for custom endpoints that VS Code Chat can use with images.
2. **Always disable images for unknown VS Code LM models**: rejected because it causes silent image removal and contradicts VS Code Chat behavior.
3. **Bypass `maybeRemoveImageBlocks()` for VS Code LM only**: rejected because capability propagation is used by UI, tools, and prompts; fixing only the final request would leave inconsistent behavior.
