# Zoo Code v3.64.24

## Tool-Call Pipeline Fixes (MiMo / OpenAI-Compatible Gateways)

- **Parameter serialization**: Fixed `[object Object]` leaks when models emit objects for string params (read_spec, write_spec, delete_spec, web_research, list_mcp_config, search_files, codebase_search, generate_image)
- **Shell selection**: `execute_command` now prefers PowerShell over cmd.exe on Windows
- **Browser tools**: `click_browser_by_text` no longer shows false "context destroyed" errors after navigation
- **UI cleanup**: Malformed/garbled tool-call markup fragments are stripped from chat display — users never see raw broken XML
- **Duplicate messages**: Fixed "Zoo said" text appearing twice when model emits prose + XML tool markup
- **generate_image**: `"None"` sentinel treated as null for optional image parameter

## Infrastructure

- MiMo now routes tools through `convertToolsForOpenAI` (gateway-safe `strict: false`)
- Nullable union types stripped from schemas for gateway compatibility
- `playwright-core` correctly bundled in .vsix

All tools verified working on both Xiaomi built-in and OpenAI Compatible providers.
