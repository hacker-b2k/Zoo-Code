/**
 * Spec Workspace panel HTML (F-002 + F-008 preview).
 * Inline HTML/CSS/JS for editor + split preview with markdown/mermaid rendering.
 *
 * F-008: Loads a bundled preview script (spec-preview.js) and mermaid UMD
 * from extension dist via localResourceRoots. The preview module exposes
 * window.__specPreview for markdown rendering and mermaid slot rendering.
 */

export function buildSpecWorkspaceHtml(
	nonce: string,
	cspSource: string,
	previewScriptUri?: string,
	mermaidScriptUri?: string,
): string {
	const previewScriptTag = previewScriptUri ? `<script nonce="${nonce}" src="${previewScriptUri}"></script>` : ""
	const mermaidScriptTag = mermaidScriptUri ? `<script nonce="${nonce}" src="${mermaidScriptUri}"></script>` : ""
	// F-008: script-src includes cspSource (for preview bundle + mermaid UMD)
	// and 'unsafe-eval' (mermaid v11 requires it for some diagram types).
	const scriptSrc = `script-src 'nonce-${nonce}' ${cspSource} 'unsafe-eval'`
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; ${scriptSrc};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Spec Workspace</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border, #444);
      --btn: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --muted: var(--vscode-descriptionForeground);
      --list-hover: var(--vscode-list-hoverBackground);
      --list-active: var(--vscode-list-activeSelectionBackground);
      /*
       * F-025 interaction design tokens.
       * Every interactive surface (tabs, header actions, toolbars) derives its
       * colour from these tokens only, so the accent/hover/elevation treatment
       * follows the active IDE theme automatically. No literal colours here:
       * each token resolves to a VS Code theme variable, with a theme-derived
       * fallback for themes that do not contribute the primary variable.
       */
      --accent: var(--vscode-button-background, var(--vscode-focusBorder));
      --accent-hover: var(--vscode-button-hoverBackground, var(--vscode-button-background));
      --accent-fg: var(--vscode-button-foreground, var(--vscode-editor-foreground));
      --surface: var(--vscode-editorWidget-background, var(--vscode-input-background));
      --surface-hover: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
      --surface-border: var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      --focus-ring: var(--vscode-focusBorder, var(--vscode-panel-border));
      --elevation-0: none;
      --elevation-1: 0 1px 2px var(--vscode-widget-shadow, transparent);
      --elevation-2: 0 2px 7px var(--vscode-widget-shadow, transparent);
      --motion-fast: 120ms;
      --motion-ease: cubic-bezier(0.2, 0, 0.2, 1);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      background: var(--bg);
      color: var(--fg);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    header h1 {
      font-size: 13px;
      font-weight: 600;
      margin: 0;
      flex: 1;
    }
    button, input[type="text"] {
      font: inherit;
    }
    /*
     * Shared interaction contract for every button in this webview
     * (Refresh / Import / Export / Delete / New Spec / Save, toolbar actions
     * and the document tabs). Only background, colour, border-colour and
     * box-shadow are animated, so hovering can never reflow the layout:
     * the border box keeps a constant 1px border and constant padding in all
     * states, and elevation is expressed purely as a shadow.
     */
    button {
      background: var(--accent);
      color: var(--accent-fg);
      border: 1px solid transparent;
      padding: 4px 10px;
      cursor: pointer;
      border-radius: 2px;
      box-shadow: var(--elevation-0);
      transition:
        background var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease),
        border-color var(--motion-fast) var(--motion-ease),
        box-shadow var(--motion-fast) var(--motion-ease);
    }
    button:hover:not(:disabled) {
      background: var(--accent-hover);
      box-shadow: var(--elevation-2);
    }
    /* Secondary actions sit on a subtle surface so they stay visible when idle. */
    button.secondary {
      background: var(--surface);
      color: var(--fg);
      border-color: var(--border);
    }
    button.secondary:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--fg);
      border-color: var(--focus-ring);
      box-shadow: var(--elevation-2);
    }
    /* Pressing settles the surface back down instead of resizing it. */
    button:active:not(:disabled) { box-shadow: var(--elevation-1); }
    button:focus-visible {
      outline: 1px solid var(--focus-ring);
      outline-offset: 1px;
    }
    button:disabled { opacity: 0.5; cursor: default; box-shadow: var(--elevation-0); }
    @media (prefers-reduced-motion: reduce) {
      button { transition: none; }
    }
    /*
     * Icon-only toolbar action. Convention for all header/toolbar icon buttons:
     *   1. Use class="icon-button" on the <button> element.
     *   2. Inline the VS Code codicon SVG (from @vscode/codicons, already a
     *      project dependency) with fill="currentColor" so the icon inherits
     *      the button text-color token.
     *   3. Set aria-label="<action name>" and title="<action name>" for
     *      accessibility and tooltip.
     *   4. Add the disabled attribute when the action is unavailable — the
     *      disabled style below renders a clearly-off state (muted color,
     *      no hover) and the native disabled attribute prevents clicks.
     * Existing examples: Refresh, Import, Export, Delete, Open in Editor.
     * For primary CTAs needing a text label, use class="cta-button" instead.
     */
    button.icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      color: var(--muted);
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 4px;
      box-shadow: none;
      transition:
        background var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease),
        border-color var(--motion-fast) var(--motion-ease);
    }
    button.icon-button svg {
      width: 16px;
      height: 16px;
      display: block;
      fill: currentColor;
    }
    button.icon-button:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--fg);
      border-color: transparent;
      box-shadow: none;
    }
    button.icon-button:active:not(:disabled) {
      background: var(--surface);
      box-shadow: none;
    }
    button.icon-button:focus-visible {
      outline: 1px solid var(--focus-ring);
      outline-offset: 1px;
    }
    button.icon-button:disabled {
      color: var(--surface-border);
      background: transparent;
      border-color: transparent;
      box-shadow: none;
      opacity: 0.55;
      cursor: default;
    }
    /*
     * Primary CTA with icon + text (New Spec, Save). Keeps the accent
     * background for discoverability but uses inline-flex to align the
     * icon and label on a clean baseline with a small gap. Inherits the
     * shared button transitions for a consistent feel.
     */
    button.cta-button {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
    }
    button.cta-button svg {
      width: 14px;
      height: 14px;
      display: block;
      fill: currentColor;
      flex-shrink: 0;
    }
    .status {
      padding: 4px 12px;
      font-size: 12px;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      min-height: 22px;
    }
    .status.error { color: var(--vscode-errorForeground, #f44); }
    .status.ok { color: var(--vscode-testing-iconPassed, #3c3); }
    .status.streaming { color: var(--vscode-charts-blue, #39c); font-weight: 500; }
    main {
      flex: 1;
      display: grid;
      grid-template-columns: 220px 1fr;
      min-height: 0;
    }
    aside {
      border-right: 1px solid var(--border);
      overflow: auto;
      padding: 8px;
    }
    .spec-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    /*
     * F-026 spec card component.
     * The sidebar reuses the same interaction tokens as the document tabs and
     * the header actions, so a spec card reads as part of one surface system.
     * Geometry is identical in every state: the 1px border and the 3px accent
     * rail are always painted (the rail is transparent when idle) and only
     * background, colour, border-colour and box-shadow are animated, so
     * hovering or selecting a card can never reflow the list.
     */
    .spec-card {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr);
      align-items: start;
      column-gap: 8px;
      padding: 7px 9px;
      border: 1px solid var(--surface-border);
      border-left: 3px solid transparent;
      border-radius: 6px;
      background: var(--surface);
      color: var(--fg);
      cursor: pointer;
      box-shadow: var(--elevation-0);
      transition:
        background var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease),
        border-color var(--motion-fast) var(--motion-ease),
        box-shadow var(--motion-fast) var(--motion-ease);
    }
    .spec-card:hover {
      background: var(--surface-hover);
      border-color: var(--surface-border);
      border-left-color: var(--focus-ring);
      box-shadow: var(--elevation-1);
    }
    .spec-card:focus-visible {
      outline: 1px solid var(--focus-ring);
      outline-offset: 1px;
    }
    /* Selection is theme-driven: list selection surface plus an accent rail. */
    .spec-card.active {
      background: var(--vscode-list-activeSelectionBackground, var(--surface-hover));
      color: var(--vscode-list-activeSelectionForeground, var(--fg));
      border-color: var(--accent);
      border-left-color: var(--accent);
      box-shadow: var(--elevation-1);
    }
    .spec-card.active:hover {
      background: var(--vscode-list-activeSelectionBackground, var(--surface-hover));
      border-color: var(--focus-ring);
      border-left-color: var(--accent);
      box-shadow: var(--elevation-2);
    }
    /*
     * F-027 order indicator. A numbered circle replaces the old document-type
     * file glyph: the sidebar identifies a spec by its position in the list,
     * never by document kind. Colours come from IDE theme variables only and
     * the box keeps the exact 20px footprint of the previous icon tile, so
     * swapping the indicator cannot reflow the card grid.
     */
    .spec-card-index {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: var(--vscode-badge-background, var(--border));
      color: var(--vscode-badge-foreground, var(--fg));
      border: 1px solid transparent;
      font-size: 10px;
      font-weight: 600;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
      transition:
        background var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease),
        border-color var(--motion-fast) var(--motion-ease);
    }
    .spec-card:hover .spec-card-index {
      border-color: var(--focus-ring);
    }
    .spec-card.active .spec-card-index {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: var(--accent);
    }
    .spec-card-body { display: block; min-width: 0; }
    /* Title outranks metadata: heavier, larger, clamped to two lines. */
    .spec-card-title {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.35;
      overflow-wrap: anywhere;
      color: inherit;
    }
    .spec-card-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px 6px;
      margin-top: 5px;
      font-size: 10px;
      font-weight: 400;
      line-height: 1.4;
      color: var(--muted);
    }
    .spec-card-date { color: var(--muted); white-space: nowrap; }
    .spec-card.active .spec-card-date { color: inherit; opacity: 0.85; }
    @media (prefers-reduced-motion: reduce) {
      .spec-card, .spec-card-index { transition: none; }
    }
    .empty { color: var(--muted); padding: 8px; font-size: 12px; }
    section.editor {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }
    .tabs {
      display: flex;
      gap: 8px;
      padding: 8px 12px 4px;
      border-bottom: 1px solid var(--border);
    }
    /*
     * Requirements / Design / Tasks tabs.
     * Idle tabs render on the same subtle surface as the secondary header
     * actions so they never look like bare text; hover lifts only the hovered
     * tab; the active tab switches to the theme accent. font-weight is fixed
     * across all three states so activating a tab cannot change its width.
     * Background is tight-fit to content (badge + label) — no oversized box.
     * The 8px gap between tabs gives each one clear separation.
     */
    .tab {
      display: inline-flex;
      align-items: center;
      background: var(--surface);
      color: var(--muted);
      border: 1px solid var(--surface-border);
      border-radius: 999px;
      padding: 3px 10px 3px 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      width: auto;
      box-shadow: var(--elevation-0);
      transition:
        background var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease),
        border-color var(--motion-fast) var(--motion-ease),
        box-shadow var(--motion-fast) var(--motion-ease);
    }
    button.tab:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--fg);
      border-color: var(--focus-ring);
      box-shadow: var(--elevation-2);
    }
    button.tab.active {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: var(--accent);
      box-shadow: var(--elevation-1);
    }
    button.tab.active:hover:not(:disabled) {
      background: var(--accent-hover);
      color: var(--accent-fg);
      border-color: var(--focus-ring);
      box-shadow: var(--elevation-2);
    }
    .tab-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--vscode-badge-background, var(--border));
      color: var(--vscode-badge-foreground, var(--fg));
      font-size: 10px;
      font-weight: 700;
      margin-right: 5px;
      flex-shrink: 0;
      line-height: 1;
      padding: 0 3px;
      transition:
        background var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease);
    }
    /* On the accent-filled active tab the badge inverts, still theme-driven. */
    .tab.active .tab-badge {
      background: var(--accent-fg);
      color: var(--accent);
    }
    @media (prefers-reduced-motion: reduce) {
      .tab, .tab-badge { transition: none; }
    }
    .editor-toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
    }
    .editor-toolbar .rev { font-size: 11px; color: var(--muted); flex: 1; }
    textarea {
      flex: 1;
      width: 100%;
      margin: 0 12px 12px;
      padding: 10px;
      resize: none;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.45;
    }
    .create-row {
      display: none;
      gap: 6px;
      padding: 8px;
      border-bottom: 1px solid var(--border);
    }
    .create-row.visible { display: flex; }
    .create-row input {
      flex: 1;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      padding: 4px 8px;
    }
    /* F-008: Split pane + preview */
    .pane-grid {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      min-height: 0;
      overflow: hidden;
    }
    .pane-grid.mode-edit { grid-template-columns: minmax(0,1fr) minmax(0,0fr); }
    .pane-grid.mode-preview { grid-template-columns: minmax(0,0fr) minmax(0,1fr); }
    /* Do NOT use display:none to hide panes — display:none removes the item
       from grid flow, causing the remaining pane to auto-place into the
       wrong (collapsed 0fr) column. Preview mode appeared empty because of
       this. Rely on minmax(0,0fr) + min-width:0 + overflow:hidden to collapse
       instead, while keeping both items in their correct grid columns. */
    .pane-grid.mode-edit .preview-pane,
    .pane-grid.mode-preview .editor-pane { border-left: none; }
    .editor-pane {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .preview-pane {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      border-left: 1px solid var(--border);
      overflow: hidden;
      background: var(--bg);
    }
    .preview-pane textarea {
      flex: 1;
      margin: 0;
      border: none;
      border-radius: 0;
      resize: none;
      padding: 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.6;
      background: var(--bg);
      color: var(--fg);
    }
    /*
     * Segmented view-toggle control (Edit / Split / Preview).
     * One shared container with a single border, segments sit flush
     * against each other (no individual boxes). Active segment uses the
     * theme accent; inactive segments are transparent. Each segment shows
     * an inline codicon + short label.
     */
    .view-toggle {
      display: inline-flex;
      align-items: stretch;
      margin-left: auto;
      border: 1px solid var(--border);
      border-radius: 4px;
      overflow: hidden;
      background: transparent;
    }
    .view-toggle button {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: transparent;
      color: var(--muted);
      border: none;
      border-right: 1px solid var(--border);
      padding: 3px 8px;
      font-size: 11px;
      box-shadow: none;
      border-radius: 0;
    }
    .view-toggle button:last-child { border-right: none; }
    .view-toggle button svg {
      width: 13px;
      height: 13px;
      display: block;
      fill: currentColor;
      flex-shrink: 0;
    }
    .view-toggle button:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--fg);
      border-color: var(--border);
      border-right-color: var(--border);
      box-shadow: none;
    }
    .view-toggle button.active {
      color: var(--accent-fg);
      background: var(--accent);
    }
    .view-toggle button.active:hover:not(:disabled) {
      background: var(--accent-hover);
      color: var(--accent-fg);
      box-shadow: none;
    }
    .view-toggle button:disabled {
      opacity: 0.5;
      cursor: default;
      box-shadow: none;
    }
    #preview {
      flex: 1;
      overflow: auto;
      padding: 16px 20px;
      font-size: 14px;
      line-height: 1.6;
    }
    #preview h1, #preview h2, #preview h3, #preview h4, #preview h5, #preview h6 {
      margin: 1em 0 0.5em;
      font-weight: 600;
    }
    #preview h1 { font-size: 1.6em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
    #preview h2 { font-size: 1.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
    #preview h3 { font-size: 1.2em; }
    #preview p { margin: 0.6em 0; }
    #preview ul, #preview ol { margin: 0.5em 0; padding-left: 1.8em; }
    #preview li { margin: 0.2em 0; }
    #preview .task-list-item { list-style: none; }
    #preview code {
      background: var(--input-bg);
      padding: 2px 5px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.9em;
    }
    #preview pre {
      background: var(--input-bg);
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 0.8em 0;
    }
    #preview pre code {
      background: transparent;
      padding: 0;
      font-size: 0.85em;
    }
    #preview table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.8em 0;
    }
    #preview th, #preview td {
      border: 1px solid var(--border);
      padding: 6px 10px;
      text-align: left;
    }
    #preview th { background: var(--input-bg); font-weight: 600; }
    #preview blockquote {
      margin: 0.8em 0;
      padding-left: 12px;
      border-left: 3px solid var(--border);
      color: var(--muted);
    }
    #preview hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 1.2em 0;
    }
    #preview a {
      color: var(--vscode-textLink-foreground, #6cb6ff);
    }
    #preview .mermaid-slot {
      text-align: center;
      margin: 1em 0;
      padding: 12px;
      background: var(--input-bg);
      border-radius: 4px;
      min-height: 40px;
    }
    #preview .mermaid-slot svg { max-width: 100%; height: auto; }
    #preview .mermaid-error {
      border: 1px solid var(--vscode-errorForeground, #f44);
      padding: 8px;
      border-radius: 4px;
      text-align: left;
    }
    #preview .mermaid-error-msg {
      color: var(--vscode-errorForeground, #f44);
      font-size: 12px;
      margin-bottom: 6px;
    }
    #preview .preview-truncated {
      color: var(--vscode-editorWarning-foreground, #cca700);
      font-size: 12px;
      padding: 8px;
      border: 1px dashed var(--border);
      border-radius: 4px;
      margin: 8px 0;
    }
    .preview-overlay {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px 16px;
      font-size: 12px;
      color: var(--muted);
      pointer-events: none;
      display: none;
    }
    .preview-overlay.visible { display: block; }
    .preview-pane-wrap { position: relative; flex: 1; display: flex; min-height: 0; }
    /* F-024: Selection UI is fixed so it never alters editor or preview layout. */
    .selection-action-bubble {
      position: fixed;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 7px;
      border: 1px solid var(--vscode-focusBorder, var(--border));
      border-radius: 999px;
      background: var(--vscode-editorWidget-background, var(--bg));
      color: var(--vscode-editorWidget-foreground, var(--fg));
      box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, .25));
      font-size: 12px;
      line-height: 18px;
      opacity: 0;
      pointer-events: none;
      transform: translateY(3px) scale(.96);
      transition: opacity 120ms ease, transform 120ms ease;
    }
    .selection-action-bubble.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0) scale(1);
    }
    .selection-action-bubble button {
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
    }
    /* The bubble is already elevated, so its trigger only tints on hover. */
    .selection-action-bubble button:hover:not(:disabled) {
      background: transparent;
      color: var(--vscode-textLink-activeForeground, inherit);
      box-shadow: var(--elevation-0);
    }
    .selection-action-popup {
      position: fixed;
      z-index: 21;
      min-width: 164px;
      padding: 4px;
      border: 1px solid var(--vscode-menu-border, var(--border));
      border-radius: 4px;
      background: var(--vscode-menu-background, var(--bg));
      box-shadow: 0 4px 14px var(--vscode-widget-shadow, rgba(0, 0, 0, .28));
      opacity: 0;
      pointer-events: none;
      transform: translateY(-3px) scale(.98);
      transform-origin: top left;
      transition: opacity 120ms ease, transform 120ms ease;
    }
    .selection-action-popup.visible { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }
    .selection-action-popup button {
      display: block;
      width: 100%;
      padding: 5px 8px;
      border: 0;
      border-radius: 2px;
      background: transparent;
      color: var(--vscode-menu-foreground, var(--fg));
      text-align: left;
      font: inherit;
      font-size: 12px;
    }
    .selection-action-popup button:hover:not(:disabled),
    .selection-action-popup button:focus-visible { background: var(--vscode-menu-selectionBackground, var(--list-hover)); color: var(--vscode-menu-selectionForeground, var(--fg)); box-shadow: var(--elevation-0); outline: none; }
   </style>
</head>
<body>
  <header>
    <h1>Spec Workspace</h1>
    <button id="btnRefresh" class="icon-button" type="button" aria-label="Refresh" title="Refresh"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M2.006 8.267L.78 9.5 0 8.73l2.09-2.07.76.01 2.09 2.12-.76.76-1.167-1.18a5 5 0 0 0 9.4 1.983l.813.597a6 6 0 0 1-11.22-2.683zm10.99-.466L11.76 6.55l-.76.76 2.09 2.11.76.01 2.09-2.07-.75-.76-1.194 1.18a6 6 0 0 0-11.11-2.92l.81.594a5 5 0 0 1 9.3 2.346z"/></svg></button>
    <button id="btnImport" class="icon-button" type="button" aria-label="Import plans/specs" title="Import plans/specs"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.957 6h.05a2.99 2.99 0 0 1 2.116.879 3.003 3.003 0 0 1 0 4.242 2.99 2.99 0 0 1-2.117.879v-1a2.002 2.002 0 0 0 0-4h-.914l-.123-.857a2.49 2.49 0 0 0-2.126-2.122A2.478 2.478 0 0 0 6.231 5.5l-.333.762-.809-.189A2.49 2.49 0 0 0 4.523 6c-.662 0-1.297.263-1.764.732A2.503 2.503 0 0 0 4.523 11h.498v1h-.498a3.486 3.486 0 0 1-2.628-1.16 3.502 3.502 0 0 1 1.958-5.78 3.462 3.462 0 0 1 1.468.04 3.486 3.486 0 0 1 3.657-2.06A3.479 3.479 0 0 1 11.957 6zm-5.25 5.121l1.314 1.314V7h.994v5.4l1.278-1.279.707.707-2.146 2.147h-.708L6 11.829l.707-.708z"/></svg></button>
    <button id="btnExport" class="icon-button" type="button" aria-label="Export spec" title="Export spec"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.956 6h.05a2.99 2.99 0 0 1 2.117.879 3.003 3.003 0 0 1 0 4.242 2.99 2.99 0 0 1-2.117.879h-1.995v-1h1.995a2.002 2.002 0 0 0 0-4h-.914l-.123-.857a2.49 2.49 0 0 0-2.126-2.122A2.478 2.478 0 0 0 6.23 5.5l-.333.762-.809-.189A2.49 2.49 0 0 0 4.523 6c-.662 0-1.297.263-1.764.732A2.503 2.503 0 0 0 4.523 11h2.494v1H4.523a3.486 3.486 0 0 1-2.628-1.16 3.502 3.502 0 0 1-.4-4.137A3.497 3.497 0 0 1 3.853 5.06c.486-.09.987-.077 1.468.041a3.486 3.486 0 0 1 3.657-2.06A3.479 3.479 0 0 1 11.956 6zm-1.663 3.853L8.979 8.54v5.436h-.994v-5.4L6.707 9.854 6 9.146 8.146 7h.708L11 9.146l-.707.707z"/></svg></button>
    <button id="btnDelete" class="icon-button" type="button" aria-label="Delete spec" title="Delete spec" disabled><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z"/></svg></button>
    <button id="btnCreate" class="cta-button" type="button" aria-label="New Spec" title="New Spec"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg>New Spec</button>
    <button id="btnSave" class="cta-button" type="button" aria-label="Save" title="Save" disabled><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.353 1.146l1.5 1.5L15 3v11.5l-.5.5h-13l-.5-.5v-13l.5-.5H13l.353.146zM2 2v12h12V3.208L12.793 2H11v4H4V2H2zm6 0v3h2V2H8z"/></svg>Save</button>
  </header>
  <div id="status" class="status">Loading…</div>
  <div id="createRow" class="create-row">
    <input id="createTitle" type="text" placeholder="Spec title" />
    <button id="btnCreateConfirm" type="button">Create</button>
    <button id="btnCreateCancel" class="secondary" type="button">Cancel</button>
  </div>
  <main>
    <aside>
      <div id="specList" class="empty">No specs yet.</div>
    </aside>
    <section class="editor">
      <div class="tabs" id="tabs"></div>
      <div class="editor-toolbar">
        <span id="docMeta" class="rev">Select a spec</span>
        <button id="btnOpenEditor" class="icon-button" type="button" aria-label="Open in Editor" title="Open in Editor" disabled><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M6 5.914l2.06-2.06v-.708L5.915 1l-.707.707.043.043.25.25 1 1h-3a2.5 2.5 0 0 0 0 5H4V7h-.5a1.5 1.5 0 1 1 0-3h3L5.207 5.293 5.914 6 6 5.914zM11 2H8.328l-1-1H12l.71.29 3 3L16 5v9l-1 1H6l-1-1V6.5l1 .847V14h9V6h-4V2zm1 0v3h3l-3-3z"/></svg></button>
        <div class="view-toggle" role="group" aria-label="Document view mode">
          <button id="btnViewEdit" type="button" aria-label="Edit only" title="Edit only" aria-pressed="false"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/></svg>Edit</button>
          <button id="btnViewSplit" class="active" type="button" aria-label="Split view" title="Edit + Preview" aria-pressed="true"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path d="M14 1H3L2 2v11l1 1h11l1-1V2l-1-1zM8 13H3V2h5v11zm6 0H9V2h5v11z"/></svg>Split</button>
          <button id="btnViewPreview" type="button" aria-label="Preview only" title="Preview only" aria-pressed="false"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M3 1h11l1 1v5.3a3.21 3.21 0 0 0-1-.3V2H9v10.88L7.88 14H3l-1-1V2l1-1zm0 12h5V2H3v11zm10.379-4.998a2.53 2.53 0 0 0-1.19.348h-.03a2.51 2.51 0 0 0-.799 3.53L9 14.23l.71.71 2.35-2.36c.325.22.7.358 1.09.4a2.47 2.47 0 0 0 1.14-.13 2.51 2.51 0 0 0 1-.63 2.46 2.46 0 0 0 .58-1 2.63 2.63 0 0 0 .07-1.15 2.53 2.53 0 0 0-1.35-1.81 2.53 2.53 0 0 0-1.211-.258zm.24 3.992a1.5 1.5 0 0 1-.979-.244 1.55 1.55 0 0 1-.56-.68 1.49 1.49 0 0 1-.08-.86 1.49 1.49 0 0 1 1.18-1.18 1.49 1.49 0 0 1 .86.08c.276.117.512.311.68.56a1.5 1.5 0 0 1-1.1 2.324z"/></svg>Preview</button>
        </div>
      </div>
      <div class="pane-grid mode-split" id="paneGrid">
        <div class="editor-pane">
          <textarea id="editor" spellcheck="false" disabled placeholder="Select or create a spec to edit…"></textarea>
        </div>
        <div class="preview-pane">
          <div class="preview-pane-wrap">
            <div id="preview" class="preview"><span class="empty" style="color:var(--muted);font-size:12px;padding:8px;">Preview renders markdown and mermaid diagrams.</span></div>
            <div id="previewOverlay" class="preview-overlay">Agent writing…</div>
          </div>
        </div>
      </div>
    </section>
  </main>
  <!-- F-024: kept outside selectable surfaces to preserve native selection. -->
  <div id="selectionActionBubble" class="selection-action-bubble" role="presentation" aria-hidden="true">
    <button id="selectionActionTrigger" type="button" aria-haspopup="menu" aria-expanded="false">✨ Ask AI</button>
  </div>
  <div id="selectionActionPopup" class="selection-action-popup" role="menu" aria-label="Selected content actions" aria-hidden="true">
    <button type="button" role="menuitem" data-selection-action="rewrite">✨ Rewrite</button>
    <button type="button" role="menuitem" data-selection-action="improve">✨ Improve</button>
    <button type="button" role="menuitem" data-selection-action="remove">🗑 Remove</button>
    <button type="button" role="menuitem" data-selection-action="custom">✨ Custom…</button>
  </div>
  ${mermaidScriptTag}
  ${previewScriptTag}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let specs = [];
    let specDocs = [];
    let activeSpecId = null;
    let activeKind = "requirements";
    let dirty = false;
    let currentRevision = null;
    // F-020 live agent stream (UI preview only — not durable until finalized)
    let agentStreaming = false;
    let agentStreamId = null;
    // Identity of the doc the active stream is writing, used to narrow the
    // document-message guard so only stream-owned docs are protected from
    // authoritative host pushes (other docs must always update live).
    let streamSpecId = null;
    let streamDocKind = null;
    let lastCommittedContent = "";
    let lastCommittedSpecId = null;
    let lastCommittedKind = null;
    let streamPinnedAtBottom = true;
    let lastMetaUpdateAt = 0;
    let pendingPartialRaf = null;
    let pendingPartialMsg = null;
    // F-008: preview state
    let viewMode = "split"; // "edit" | "split" | "preview"
    let previewDebounceTimer = null;
    let previewRenderPending = false;

    const statusEl = document.getElementById("status");
    const listEl = document.getElementById("specList");
    const editor = document.getElementById("editor");
    const docMeta = document.getElementById("docMeta");
    const btnSave = document.getElementById("btnSave");
    const btnOpenEditor = document.getElementById("btnOpenEditor");
    const createRow = document.getElementById("createRow");
    const createTitle = document.getElementById("createTitle");
    const previewEl = document.getElementById("preview");
    const previewOverlay = document.getElementById("previewOverlay");
    const paneGrid = document.getElementById("paneGrid");
    const btnViewEdit = document.getElementById("btnViewEdit");
    const btnViewSplit = document.getElementById("btnViewSplit");
    const btnViewPreview = document.getElementById("btnViewPreview");
    const selectionBubble = document.getElementById("selectionActionBubble");
    const selectionTrigger = document.getElementById("selectionActionTrigger");
    const selectionPopup = document.getElementById("selectionActionPopup");
    const MAX_SELECTION_CHARS = 32 * 1024;
    let selectionShowTimer = null;
    let selectionSnapshot = null;

    // F-024b: the webview contributes only what it alone can know — the literal
    // selected text and, where resolvable, its offsets in the editor buffer. Every
    // derived location fact (heading path, block type, table/list/task/mermaid
    // context, surrounding text, confidence, anchor, document map) is computed
    // host-side by resolveSelectionContext against the authoritative document.
    // Deriving it a second time here would produce a parallel implementation whose
    // output is discarded, and which silently drifts from the one that is used.

    // F-024: local selection capture. The host validates and tokenizes the action.
    function hideSelectionActions() {
      if (selectionShowTimer) { clearTimeout(selectionShowTimer); selectionShowTimer = null; }
      selectionSnapshot = null;
      selectionBubble.classList.remove("visible");
      selectionPopup.classList.remove("visible");
      selectionBubble.setAttribute("aria-hidden", "true");
      selectionPopup.setAttribute("aria-hidden", "true");
      selectionTrigger.setAttribute("aria-expanded", "false");
    }

    function placeSelectionElement(el, left, top) {
      const width = el.offsetWidth || 164;
      const height = el.offsetHeight || 28;
      el.style.left = Math.max(8, Math.min(left, window.innerWidth - width - 8)) + "px";
      el.style.top = Math.max(8, Math.min(top, window.innerHeight - height - 8)) + "px";
    }

    function lineAt(value, offset) { return value.slice(0, offset).split("\\n").length; }

    function selectionSnapshotFromEditor() {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      if (end <= start) return null;
      const text = editor.value.slice(start, end);
      if (!text) return null;
      const rect = editor.getBoundingClientRect();
      const selectedText = text.slice(0, MAX_SELECTION_CHARS);
      // Editor selections are exact by construction: the offsets come from the buffer.
      return { source: "editor", selectedText: selectedText, truncated: text.length > MAX_SELECTION_CHARS,
        startOffset: start, endOffset: start + selectedText.length,
        startLine: lineAt(editor.value, start), endLine: lineAt(editor.value, start + selectedText.length),
        mappingConfidence: "exact", rect: { left: rect.left + 18, top: rect.top + 38 } };
    }

    function selectionSnapshotFromPreview() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !previewEl.contains(selection.anchorNode) || !previewEl.contains(selection.focusNode)) return null;
      const text = selection.toString();
      if (!text) return null;
      const matches = [];
      let from = 0;
      while (true) { const index = editor.value.indexOf(text, from); if (index < 0) break; matches.push(index); from = index + Math.max(1, text.length); }
      let start = matches.length === 1 ? matches[0] : undefined;
      let mapConfidence = matches.length === 1 ? "exact" : (matches.length ? "approximate" : "unmapped");
      // F-024b: improve ambiguous preview-to-source mapping using heading context
      if (matches.length > 1 && selection.anchorNode) {
        var anchorNode = selection.anchorNode;
        var headingEl = null;
        var cur = anchorNode.nodeType === 3 ? anchorNode.parentElement : anchorNode;
        while (cur && cur !== previewEl) {
          if (/^H[1-6]$/.test(cur.tagName)) { headingEl = cur; break; }
          cur = cur.parentElement;
        }
        if (headingEl) {
          var headingText = headingEl.textContent.trim();
          var docLines = editor.value.split("\\n");
          var headingLineIdx = -1;
          for (var hi = 0; hi < docLines.length; hi++) {
            var hm = docLines[hi].match(/^(#{1,6})\s+(.*)/);
            if (hm && hm[2].trim() === headingText) { headingLineIdx = hi; break; }
          }
          if (headingLineIdx >= 0) {
            var headingOffset = docLines.slice(0, headingLineIdx).join("\\n").length + (headingLineIdx > 0 ? 1 : 0);
            var headingDepth = docLines[headingLineIdx].match(/^(#{1,6})/)[1].length;
            var sectionEnd = editor.value.length;
            for (var si = headingLineIdx + 1; si < docLines.length; si++) {
              var sm = docLines[si].match(/^(#{1,6})\s/);
              if (sm && sm[1].length <= headingDepth) {
                sectionEnd = docLines.slice(0, si).join("\\n").length;
                break;
              }
            }
            var filtered = matches.filter(function(m) { return m >= headingOffset && m < sectionEnd; });
            if (filtered.length === 1) {
              start = filtered[0];
              mapConfidence = "exact";
            } else if (filtered.length > 1) {
              var bestMatch = filtered[0];
              var bestScore = -1;
              for (var fi = 0; fi < filtered.length; fi++) {
                var score = 0;
                var srcBefore = editor.value.slice(Math.max(0, filtered[fi] - 80), filtered[fi]);
                var srcAfter = editor.value.slice(filtered[fi] + text.length, Math.min(editor.value.length, filtered[fi] + text.length + 80));
                if (anchorNode.parentElement) {
                  var prevSib = anchorNode.previousSibling;
                  if (prevSib && prevSib.textContent) {
                    var prevText = prevSib.textContent.slice(-40);
                    if (srcBefore.indexOf(prevText) >= 0) score += 2;
                  }
                  var nextSib = anchorNode.nextSibling || (anchorNode.parentElement && anchorNode.parentElement.nextSibling);
                  if (nextSib && nextSib.textContent) {
                    var nextText = nextSib.textContent.slice(0, 40);
                    if (srcAfter.indexOf(nextText) >= 0) score += 2;
                  }
                }
                if (score > bestScore) { bestScore = score; bestMatch = filtered[fi]; }
              }
              start = bestMatch;
              mapConfidence = bestScore > 0 ? "exact" : "approximate";
            }
          }
        }
      }
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      const rect = range && range.getBoundingClientRect();
      const selectedText = text.slice(0, MAX_SELECTION_CHARS);
      const mapped = start !== undefined;
      // An unmapped preview selection sends no location hint at all. Claiming offset 0
      // / line 1 would be a fabricated anchor that drags the host's nearest-match
      // disambiguation to the top of the document; omitting it lets the host re-locate
      // the fragment honestly, or anchor to the nearest heading section.
      return { source: "preview", selectedText: selectedText, truncated: text.length > MAX_SELECTION_CHARS,
        startOffset: mapped ? start : undefined,
        endOffset: mapped ? start + selectedText.length : undefined,
        startLine: mapped ? lineAt(editor.value, start) : undefined,
        endLine: mapped ? lineAt(editor.value, start + selectedText.length) : undefined,
        mappingConfidence: mapConfidence,
        rect: rect && rect.width + rect.height ? rect : previewEl.getBoundingClientRect() };
    }

    function scheduleSelectionActions(source) {
      if (selectionShowTimer) clearTimeout(selectionShowTimer);
      selectionShowTimer = setTimeout(function() {
        selectionShowTimer = null;
        if (agentStreaming) return hideSelectionActions();
        const next = source === "editor" ? selectionSnapshotFromEditor() : selectionSnapshotFromPreview();
        if (!next) return hideSelectionActions();
        selectionSnapshot = next;
        placeSelectionElement(selectionBubble, next.rect.left, next.rect.top - 34);
        selectionBubble.classList.add("visible");
        selectionBubble.setAttribute("aria-hidden", "false");
      }, 135);
    }

    function showSelectionPopup() {
      if (!selectionSnapshot || agentStreaming) return;
      const rect = selectionBubble.getBoundingClientRect();
      placeSelectionElement(selectionPopup, rect.left, rect.bottom + 5);
      selectionPopup.classList.add("visible");
      selectionPopup.setAttribute("aria-hidden", "false");
      selectionTrigger.setAttribute("aria-expanded", "true");
    }

    selectionTrigger.addEventListener("mousedown", function(event) { event.preventDefault(); });
    selectionTrigger.addEventListener("click", function(event) { event.stopPropagation(); showSelectionPopup(); });
    selectionPopup.addEventListener("mousedown", function(event) { event.preventDefault(); });
    selectionPopup.addEventListener("click", function(event) {
      const action = event.target && event.target.getAttribute("data-selection-action");
      if (!action || !selectionSnapshot || agentStreaming || !activeSpecId) return;
      vscode.postMessage({ type: "aiSelectionAction", action: action, specId: activeSpecId, docKind: activeKind,
        selectedText: selectionSnapshot.selectedText, source: selectionSnapshot.source,
        startOffset: selectionSnapshot.startOffset, endOffset: selectionSnapshot.endOffset,
        startLine: selectionSnapshot.startLine, endLine: selectionSnapshot.endLine,
        mappingConfidence: selectionSnapshot.mappingConfidence, revision: currentRevision, truncated: selectionSnapshot.truncated,
        docOrder: getDocOrder(), docLabel: getDocLabel() });
      hideSelectionActions();
    });

    editor.addEventListener("select", function() { scheduleSelectionActions("editor"); });
    editor.addEventListener("keyup", function() { scheduleSelectionActions("editor"); });
    editor.addEventListener("mouseup", function() { scheduleSelectionActions("editor"); });
    previewEl.addEventListener("mouseup", function() { scheduleSelectionActions("preview"); });
    previewEl.addEventListener("keyup", function() { scheduleSelectionActions("preview"); });
    document.addEventListener("selectionchange", function() { const selection = window.getSelection(); if (!selection || selection.isCollapsed) hideSelectionActions(); });
    document.addEventListener("keydown", function(event) { if (event.key === "Escape") hideSelectionActions(); });
    document.addEventListener("mousedown", function(event) { if (!selectionBubble.contains(event.target) && !selectionPopup.contains(event.target) && event.target !== editor && !previewEl.contains(event.target)) hideSelectionActions(); });
    editor.addEventListener("scroll", hideSelectionActions);
    previewEl.addEventListener("scroll", hideSelectionActions);
    window.addEventListener("resize", hideSelectionActions);

    // F-008: preview render — uses bundled __specPreview if available.
    // During streaming: markdown is debounced (300ms), mermaid is deferred to finalize.
    function getPreviewApi() {
      return (window.__specPreview) || null;
    }

    function renderPreviewMarkdown() {
      hideSelectionActions();
      if (!previewEl) return;
      const api = getPreviewApi();
      const content = editor.value || "";
      if (api && typeof api.renderMarkdown === "function") {
        previewEl.innerHTML = api.renderMarkdown(content);
      } else {
        // Fallback: show escaped plain text if bundle not loaded
        const escaped = content.replace(/&/g, "\x26amp;").replace(/</g, "\x26lt;").replace(/>/g, "\x26gt;");
        previewEl.innerHTML = "<pre style='white-space:pre-wrap;'>" + escaped + "</pre>";
      }
    }

    function renderPreviewMermaid() {
      const api = getPreviewApi();
      if (api && typeof api.renderMermaidSlots === "function" && previewEl) {
        api.renderMermaidSlots(previewEl).catch(function() {});
      }
    }

    function schedulePreviewRender(debounceMs) {
      if (viewMode === "edit") return; // no preview in edit-only mode
      if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
      previewDebounceTimer = setTimeout(function() {
        previewDebounceTimer = null;
        renderPreviewMarkdown();
        // Only render mermaid when NOT streaming (defer to finalize)
        if (!agentStreaming) {
          renderPreviewMermaid();
        }
      }, debounceMs || 0);
    }

    function schedulePreviewDebounced() {
      schedulePreviewRender(300);
    }

    function setViewMode(mode) {
      viewMode = mode;
      paneGrid.className = "pane-grid mode-" + mode;
      btnViewEdit.classList.toggle("active", mode === "edit");
      btnViewEdit.setAttribute("aria-pressed", mode === "edit" ? "true" : "false");
      btnViewSplit.classList.toggle("active", mode === "split");
      btnViewSplit.setAttribute("aria-pressed", mode === "split" ? "true" : "false");
      btnViewPreview.classList.toggle("active", mode === "preview");
      btnViewPreview.setAttribute("aria-pressed", mode === "preview" ? "true" : "false");
      if (mode !== "edit") {
        schedulePreviewRender(0);
      }
    }

    btnViewEdit.addEventListener("click", function() { setViewMode("edit"); });
    btnViewSplit.addEventListener("click", function() { setViewMode("split"); });
    btnViewPreview.addEventListener("click", function() { setViewMode("preview"); });

    function setStatus(msg, kind) {
      statusEl.textContent = msg || "";
      statusEl.className = "status" + (kind ? " " + kind : "");
    }

    function setAgentStreaming(on, meta) {
      hideSelectionActions();
      agentStreaming = !!on;
      if (on) {
        editor.readOnly = true;
        btnSave.disabled = true;
        // F-008: show overlay during streaming; preview stays at last markdown (no mermaid)
        if (previewOverlay) previewOverlay.classList.add("visible");
        const kind = (meta && meta.docKind) || activeKind;
        const mode = (meta && meta.mode) || "update";
        const title = (meta && meta.title) || "";
        setStatus(
          "Agent writing… " + kind + (mode === "create" ? " (new)" : "") + (title ? " · " + title : "") + " — preview only, not saved yet",
          "streaming"
        );
      } else {
        editor.readOnly = false;
        btnSave.disabled = !dirty || !activeSpecId;
        if (pendingPartialRaf) {
          cancelAnimationFrame(pendingPartialRaf);
          pendingPartialRaf = null;
          pendingPartialMsg = null;
        }
        // F-008: hide overlay + trigger full render (markdown + mermaid) on stream end
        if (previewOverlay) previewOverlay.classList.remove("visible");
        schedulePreviewRender(0);
      }
    }

    function isNearBottom() {
      try {
        return editor.scrollHeight - editor.scrollTop - editor.clientHeight < 48;
      } catch (e) {
        return true;
      }
    }

    function maybeScrollStream() {
      if (!streamPinnedAtBottom) return;
      try {
        editor.scrollTop = editor.scrollHeight;
      } catch (e) {}
    }

    function applyAgentPartial(msg) {
      if (msg.streamId && agentStreamId && msg.streamId !== agentStreamId) return;
      agentStreamId = msg.streamId || agentStreamId;
      // Keep stream doc identity in sync (partial may arrive before started
      // in edge orderings — started is the normal path).
      if (msg.specId) streamSpecId = msg.specId;
      if (msg.docKind) streamDocKind = msg.docKind;

      // Avoid list rebuild every chunk — only if selection identity changed
      let needList = false;
      if (msg.specId && msg.specId !== activeSpecId) {
        activeSpecId = msg.specId;
        needList = true;
      }
      if (msg.docKind && msg.docKind !== activeKind) {
        activeKind = msg.docKind;
        setTabs();
      }
      if (needList) renderList();

      editor.disabled = false;
      if (!agentStreaming) setAgentStreaming(true, msg);

      const fullResync = msg.fullResync === true || (msg.content != null && msg.append == null);
      if (fullResync) {
        editor.value = msg.content || "";
      } else if (typeof msg.append === "string" && typeof msg.baseLen === "number") {
        if (editor.value.length === msg.baseLen) {
          // F-020b: pure append of new suffix only
          editor.value = editor.value + msg.append;
        } else if (msg.content != null) {
          editor.value = msg.content || "";
        } else {
          // Mismatch without full body — request nothing; next fullResync will heal
          return;
        }
      } else if (msg.content != null) {
        editor.value = msg.content || "";
      }

      dirty = false;
      maybeScrollStream();
      // F-008: debounced markdown preview during streaming (no mermaid until finalize)
      schedulePreviewDebounced();

      const now = Date.now();
      if (now - lastMetaUpdateAt >= 200) {
        lastMetaUpdateAt = now;
        const n = msg.contentLength != null ? msg.contentLength : editor.value.length;
        docMeta.textContent = (msg.title || activeKind) + " · streaming · " + n + " chars";
      }
    }

    function queueAgentPartial(msg) {
      pendingPartialMsg = msg;
      if (pendingPartialRaf) return;
      pendingPartialRaf = requestAnimationFrame(() => {
        pendingPartialRaf = null;
        const m = pendingPartialMsg;
        pendingPartialMsg = null;
        if (m) applyAgentPartial(m);
      });
    }

    /**
     * Build one sidebar spec card.
     *
     * F-027: the card represents spec identity only. There is no document-type
     * badge and no document-type glyph; the leading indicator is the 1-based
     * position of the spec in the current list order. Every text node is
     * written through textContent so titles and metadata are never parsed as
     * HTML, preserving the escaping behaviour of the plain list rows.
     */
    function buildSpecCard(spec, isActive, orderIndex) {
      const card = document.createElement("div");
      card.className = "spec-card" + (isActive ? " active" : "");
      card.setAttribute("data-id", spec.id);
      card.setAttribute("role", "option");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-selected", isActive ? "true" : "false");

      const index = document.createElement("span");
      index.className = "spec-card-index";
      index.textContent = String(orderIndex);
      index.setAttribute("aria-hidden", "true");
      card.appendChild(index);

      const body = document.createElement("div");
      body.className = "spec-card-body";

      const title = document.createElement("div");
      title.className = "spec-card-title";
      title.textContent = spec.title || spec.id;
      body.appendChild(title);

      if (spec.updatedAt) {
        const meta = document.createElement("div");
        meta.className = "spec-card-meta";
        const when = document.createElement("span");
        when.className = "spec-card-date";
        when.textContent = new Date(spec.updatedAt).toLocaleString();
        meta.appendChild(when);
        body.appendChild(meta);
      }

      card.appendChild(body);
      card.title = spec.title || spec.id;
      return card;
    }

    function renderList() {
      if (!specs.length) {
        listEl.className = "empty";
        listEl.removeAttribute("role");
        listEl.textContent = "No specs yet. Click New Spec.";
        return;
      }
      listEl.className = "spec-list";
      listEl.setAttribute("role", "listbox");
      listEl.textContent = "";
      specs.forEach((spec, i) => {
        const card = buildSpecCard(spec, spec.id === activeSpecId, i + 1);
        card.addEventListener("click", () => selectSpec(spec.id));
        card.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectSpec(spec.id);
          }
        });
        listEl.appendChild(card);
      });
      const btnDelete = document.getElementById("btnDelete");
      if (btnDelete) btnDelete.disabled = !activeSpecId || agentStreaming;
    }

    function selectSpec(id) {
      hideSelectionActions();
      if (agentStreaming) {
        setStatus("Wait for agent write to finish (or cancel the task)", "error");
        return;
      }
      if (dirty && !confirm("Discard unsaved changes?")) return;
      dirty = false;
      activeSpecId = id;
      renderList();
      vscode.postMessage({ type: "openDocument", specId: id, docKind: activeKind });
    }

    /** Get the 1-based document order for the active doc kind. */
    function getDocOrder() {
      for (var i = 0; i < specDocs.length; i++) {
        if (specDocs[i].kind === activeKind) return i + 1;
      }
      return null;
    }

    /** Get the human-readable label for the active doc kind. */
    function getDocLabel() {
      var doc = specDocs.find(function(d) { return d.kind === activeKind; });
      return doc ? (doc.title || doc.kind.charAt(0).toUpperCase() + doc.kind.slice(1)) : activeKind;
    }

    /** Render dynamic numbered tabs from specDocs metadata. */
    function renderTabs() {
      var tabsEl = document.getElementById("tabs");
      if (!tabsEl) return;
      tabsEl.innerHTML = "";
      specDocs.forEach(function(doc, i) {
        var btn = document.createElement("button");
        btn.className = "tab" + (doc.kind === activeKind ? " active" : "");
        btn.setAttribute("data-kind", doc.kind);
        btn.type = "button";
        var label = doc.title || (doc.kind.charAt(0).toUpperCase() + doc.kind.slice(1));
        btn.innerHTML = '<span class="tab-badge">' + (i + 1) + "</span>" + label;
        btn.addEventListener("click", function() {
          handleTabClick(doc.kind);
        });
        tabsEl.appendChild(btn);
      });
    }

    function handleTabClick(kind) {
      hideSelectionActions();
      if (!kind || kind === activeKind) return;
      if (agentStreaming) {
        setStatus("Wait for agent write to finish before switching tabs", "error");
        return;
      }
      if (dirty && !confirm("Discard unsaved changes?")) return;
      dirty = false;
      activeKind = kind;
      setTabs();
      if (activeSpecId) {
        vscode.postMessage({ type: "openDocument", specId: activeSpecId, docKind: activeKind });
      }
    }

    function setTabs() {
      var tabsEl = document.getElementById("tabs");
      if (!tabsEl) return;
      tabsEl.querySelectorAll(".tab").forEach(function(tab) {
        tab.classList.toggle("active", tab.getAttribute("data-kind") === activeKind);
      });
    }

    editor.addEventListener("input", () => {
      if (agentStreaming) return;
      dirty = true;
      btnSave.disabled = !activeSpecId;
      setStatus("Unsaved changes", null);
      // F-008: live markdown preview on manual edit (debounced; mermaid allowed since not streaming)
      schedulePreviewDebounced();
    });

    editor.addEventListener("scroll", () => {
      if (!agentStreaming) return;
      streamPinnedAtBottom = isNearBottom();
    });

    btnOpenEditor.addEventListener("click", () => {
      if (!activeSpecId) return;
      vscode.postMessage({ type: "openInEditor", specId: activeSpecId, docKind: activeKind });
    });

    btnSave.addEventListener("click", () => {
      if (!activeSpecId || agentStreaming) return;
      btnSave.disabled = true;
      setStatus("Saving…");
      vscode.postMessage({
        type: "saveDocument",
        specId: activeSpecId,
        docKind: activeKind,
        content: editor.value,
      });
    });

    document.getElementById("btnRefresh").addEventListener("click", () => {
      vscode.postMessage({ type: "refresh" });
    });

    document.getElementById("btnImport").addEventListener("click", () => {
      vscode.postMessage({ type: "importPlans" });
    });

    document.getElementById("btnExport").addEventListener("click", () => {
      vscode.postMessage({ type: "exportSpec" });
    });

    document.getElementById("btnDelete").addEventListener("click", () => {
      if (!activeSpecId || agentStreaming) return;
      if (dirty && !confirm("Discard unsaved changes and delete this virtual spec?")) return;
      vscode.postMessage({ type: "deleteSpec", specId: activeSpecId });
    });

    document.getElementById("btnCreate").addEventListener("click", () => {
      createRow.classList.add("visible");
      createTitle.value = "";
      createTitle.focus();
    });
    document.getElementById("btnCreateCancel").addEventListener("click", () => {
      createRow.classList.remove("visible");
    });
    document.getElementById("btnCreateConfirm").addEventListener("click", () => {
      const title = createTitle.value.trim();
      if (!title) {
        setStatus("Title is required", "error");
        return;
      }
      vscode.postMessage({ type: "createSpec", title });
      createRow.classList.remove("visible");
    });

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      if (msg.type === "specsList") {
        specs = msg.entries || [];
        if (msg.activeSpecId) activeSpecId = msg.activeSpecId;
        if (msg.activeDocKind) {
          activeKind = msg.activeDocKind;
          setTabs();
        }
        renderList();
        setStatus(specs.length ? specs.length + " spec(s)" : "No specs", null);
        if (msg.activeSpecId) {
          vscode.postMessage({ type: "openDocument", specId: msg.activeSpecId, docKind: activeKind });
        }
      }

      if (msg.type === "document") {
        hideSelectionActions();
        // F-020: only ignore host-pushed documents when they would stomp the
        // ACTIVELY streaming editor for the exact same spec+doc. Any other
        // document push (different doc, or no stream in flight) is always
        // authoritative — the previous blanket agentStreaming guard is what
        // wedged the panel when a finalize message was ever lost, leaving
        // Refresh permanently unable to reload content until close-reopen.
        var streamOwnsThisDoc =
          agentStreaming &&
          streamSpecId &&
          msg.specId === streamSpecId &&
          streamDocKind &&
          (msg.docKind || activeKind) === streamDocKind;
        if (streamOwnsThisDoc) return;
        // A host-pushed document that is NOT stream-owned means any previous
        // stream for a different doc is no longer relevant to this view.
        activeSpecId = msg.specId;
        activeKind = msg.docKind || activeKind;
        if (msg.docs && msg.docs.length) {
          specDocs = msg.docs;
          renderTabs();
        } else {
          setTabs();
        }
        renderList();
        editor.disabled = false;
        editor.readOnly = false;
        editor.value = msg.content || "";
        lastCommittedContent = editor.value;
        lastCommittedSpecId = activeSpecId;
        lastCommittedKind = activeKind;
        dirty = false;
        currentRevision = msg.revision;
        btnSave.disabled = true;
        btnOpenEditor.disabled = false;
        docMeta.textContent = (msg.title || msg.docKind) + " · rev " + (msg.revision ?? "?");
        setStatus("Loaded", "ok");
        // F-008: render full preview (markdown + mermaid) on document load
        schedulePreviewRender(0);
      }

      if (msg.type === "saved") {
        dirty = false;
        currentRevision = msg.revision;
        btnSave.disabled = true;
        lastCommittedContent = editor.value;
        lastCommittedSpecId = activeSpecId;
        lastCommittedKind = activeKind;
        docMeta.textContent = (msg.title || activeKind) + " · rev " + (msg.revision ?? "?");
        setStatus("Saved", "ok");
        if (msg.entries) {
          specs = msg.entries;
          renderList();
        }
        // F-008: re-render preview after save (content may have changed server-side)
        schedulePreviewRender(0);
      }

      // F-020 / F-020b agent live stream (preview only; append protocol)
      if (msg.type === "agentWriteStarted") {
        hideSelectionActions();
        agentStreamId = msg.streamId || null;
        streamSpecId = msg.specId || null;
        streamDocKind = msg.docKind || null;
        streamPinnedAtBottom = true;
        lastMetaUpdateAt = 0;
        if (msg.specId && msg.specId !== activeSpecId) {
          activeSpecId = msg.specId;
          renderList();
        } else if (msg.specId) {
          activeSpecId = msg.specId;
        }
        if (msg.docKind && msg.docKind !== activeKind) {
          activeKind = msg.docKind;
          setTabs();
        }
        editor.disabled = false;
        setAgentStreaming(true, msg);
        docMeta.textContent = (msg.title || msg.docKind || activeKind) + " · streaming…";
      }

      if (msg.type === "agentWritePartial") {
        queueAgentPartial(msg);
      }

      if (msg.type === "agentWriteFinalized") {
        agentStreamId = null;
        streamSpecId = null;
        streamDocKind = null;
        setAgentStreaming(false, null);
        if (msg.specId) activeSpecId = msg.specId;
        if (msg.docKind) {
          activeKind = msg.docKind;
          setTabs();
        }
        if (msg.entries) {
          specs = msg.entries;
        }
        renderList();
        editor.disabled = false;
        editor.readOnly = false;
        editor.value = msg.content || "";
        lastCommittedContent = editor.value;
        lastCommittedSpecId = activeSpecId;
        lastCommittedKind = activeKind;
        dirty = false;
        currentRevision = msg.revision;
        btnSave.disabled = true;
        docMeta.textContent = (msg.title || activeKind) + " · rev " + (msg.revision ?? "?");
        setStatus("Agent write saved · rev " + (msg.revision ?? "?"), "ok");
        // F-008: full preview render with mermaid after agent write finalized
        schedulePreviewRender(0);
      }

      if (msg.type === "agentWriteAborted") {
        const sid = agentStreamId;
        agentStreamId = null;
        streamSpecId = null;
        streamDocKind = null;
        setAgentStreaming(false, null);
        // Restore last committed content for the active doc when possible
        if (lastCommittedSpecId && lastCommittedKind === activeKind && lastCommittedSpecId === (msg.specId || activeSpecId)) {
          editor.value = lastCommittedContent;
          dirty = false;
          btnSave.disabled = true;
          // F-008: restore committed preview (markdown + mermaid)
          schedulePreviewRender(0);
        } else if (msg.specId || activeSpecId) {
          vscode.postMessage({
            type: "openDocument",
            specId: msg.specId || activeSpecId,
            docKind: msg.docKind || activeKind,
          });
        }
        setStatus("Agent write cancelled: " + (msg.reason || "aborted"), "error");
      }

      if (msg.type === "importCompleted") {
        setStatus("Imported " + msg.count + " virtual spec(s)", "ok");
      }

      if (msg.type === "specDeleted") {
        if (msg.specId === activeSpecId) {
          activeSpecId = null;
          editor.value = "";
          dirty = false;
          lastCommittedContent = "";
          lastCommittedSpecId = null;
          lastCommittedKind = null;
          docMeta.textContent = "Select a spec";
          btnSave.disabled = true;
          btnOpenEditor.disabled = true;
          schedulePreviewRender(0);
        }
        setStatus("Deleted virtual spec" + (msg.title ? ': "' + msg.title + '"' : ""), "ok");
      }

      if (msg.type === "exportCompleted") {
        var exportMsg =
          "Export complete: " +
          msg.written +
          " written, " +
          msg.skipped +
          " skipped";
        if (msg.failed) {
          exportMsg += ", " + msg.failed + " failed";
        }
        if (msg.rollbackAttempted) {
          exportMsg += " (rolled back)";
        }
        setStatus(exportMsg, msg.failed ? "error" : "ok");
      }

      if (msg.type === "error") {
        setStatus(msg.message || "Error", "error");
        btnSave.disabled = agentStreaming || !dirty || !activeSpecId;
      }
    });

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`
}
