# Research: VS Code LM Image Support

## Status

Completed initial pipeline trace on 2026-06-27.

## Problem

VS Code LM models that accept images in native VS Code Chat can behave as text-only in Zoo Code. The reported example is `customendpoint/gpt-5.5`.

## Pipeline traced

1. **Model discovery**

    - `src/api/providers/vscode-lm.ts` calls `vscode.lm.selectChatModels({})` in `getVsCodeLmModels()` and maps each model through `getVsCodeLmModelInfo()`.
    - `getVsCodeLmModelInfo()` currently only checks `model.capabilities.imageInput`, `model.capabilities.vision`, static family metadata, then defaults to `false`.

2. **Selected model state**

    - `webview-ui/src/components/settings/providers/VSCodeLM.tsx` receives `vsCodeLmModels` from the extension and stores the selected model object, including `info`, through `vsCodeLmModelSelector`.
    - The settings UI currently keys VS Code LM models by `${vendor}/${family}`. That can collide for custom endpoints or multiple models with the same vendor/family but different `id` or `version`.
    - `webview-ui/src/components/ui/hooks/useSelectedModel.ts` reads `vsCodeLmModelSelector.info` and exposes model capabilities to chat UI.

3. **UI gating**

    - `webview-ui/src/components/chat/ChatView.tsx` computes `shouldDisableImages = !model?.supportsImages || selectedImages.length >= MAX_IMAGES_PER_MESSAGE`.
    - `webview-ui/src/components/chat/ChatTextArea.tsx` disables paste/drop/select image interactions when `shouldDisableImages` is true.
    - `webview-ui/src/components/chat/ChatRow.tsx` also disables image attachment while editing when `!model?.supportsImages`.

4. **Image ingestion**

    - `src/core/webview/webviewMessageHandler.ts` resolves incoming images through `resolveImageMentions()`.
    - `resolveImageMentions()` defaults `supportsImages` to `true`; the current webview handler does not pass the current provider capability. This means images are not stripped at this step because of VS Code LM capability detection.

5. **Task request generation**

    - `src/core/task/Task.ts` merges API history and then calls `maybeRemoveImageBlocks(mergedForApi, this.api)` before `buildCleanConversationHistory()` and `this.api.createMessage()`.
    - `src/api/transform/image-cleaning.ts` converts image blocks into text placeholders when `apiHandler.getModel().info.supportsImages` is false.

6. **VS Code LM request transform**
    - `src/api/transform/vscode-lm-format.ts` converts Anthropic image blocks to `vscode.LanguageModelDataPart` when that constructor is available.
    - Existing tests in `src/api/transform/__tests__/vscode-lm-format.spec.ts` already prove image blocks become data parts when they survive to this transform.

## Root cause

The root cause is capability detection and preservation for VS Code LM custom models. `getVsCodeLmModelInfo()` is too narrow: it treats a VS Code LM model as image-capable only when `capabilities.imageInput` or `capabilities.vision` is present, or when static family metadata says images are supported. Custom endpoint models can be image-capable in VS Code Chat without matching these fields/static families, so Zoo Code records `supportsImages: false`.

Once `supportsImages` is false, `Task.attemptApiRequest()` calls `maybeRemoveImageBlocks()`, which replaces image blocks with `[Referenced image in conversation]`. Therefore `convertToVsCodeLmMessages()` never gets an image block and cannot create `LanguageModelDataPart` for the final `client.sendRequest()` call.

A secondary issue is model identity in the settings UI. `VSCodeLM.tsx` uses `${vendor}/${family}` as the picker key, ignoring `id` and `version`. This can preserve or select the wrong `info` when multiple VS Code LM models share vendor/family.

## Responsible files

- `src/api/providers/vscode-lm.ts`
- `src/api/transform/image-cleaning.ts`
- `src/core/task/Task.ts`
- `src/api/transform/vscode-lm-format.ts`
- `webview-ui/src/components/settings/providers/VSCodeLM.tsx`
- `webview-ui/src/components/ui/hooks/useSelectedModel.ts`
- `webview-ui/src/components/chat/ChatView.tsx`
- `webview-ui/src/components/chat/ChatTextArea.tsx`
- `webview-ui/src/components/chat/ChatRow.tsx`

## Planned verification

- Add provider tests for broader VS Code LM image-capability shapes and fallback behavior for custom endpoints.
- Add a provider request test proving Anthropic image blocks reach `sendRequest()` as `LanguageModelDataPart`.
- Add settings hook/UI tests for preserving `info.supportsImages` and distinct model identity.
- Run targeted Vitest suites from the correct package directories.
- Runtime verification with a real VS Code LM image-capable model requires an interactive VS Code extension host and an installed/authenticated model provider. If unavailable in this environment, document exact manual steps and do not claim completed runtime verification.
