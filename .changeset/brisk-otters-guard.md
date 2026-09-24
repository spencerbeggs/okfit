---
"@okfit/mcp": minor
---

## Breaking Changes

Every served tool's `inputSchema` is now closed (`additionalProperties: false`
at every object node), and a `tools/call` whose arguments include a key the
schema does not declare now fails, naming every unknown key at every depth
plus the accepted params at that level, instead of the argument being
silently dropped. The failure shape depends on the negotiated protocol
revision: on `2025-11-25` and `2026-07-28` (Claude Code's default path) the
client gets a normal `tools/call` result with `isError: true` and the text
`Unrecognized parameter(s): …`; only `2025-06-18` returns a JSON-RPC
`InvalidParams` (`-32602`).

**Upgrade action:** send only a tool's declared arguments. A client that
previously sent extra or speculative keys alongside a valid call will now get
a hard failure instead of having those keys ignored.

```jsonc
// Before: `extra` was silently dropped, the call succeeded
{ "name": "get_concept", "arguments": { "id": "decisions/cli-exit-codes", "extra": 1 } }

// Now (2025-11-25 / 2026-07-28): isError: true, "Unrecognized parameter(s): extra..."
// Now (2025-06-18): JSON-RPC error -32602 (InvalidParams)
```

`@okfit/mcp`'s barrel (`src/index.ts`) drops two `@public` functions and
widens a `@public` schema:

* `composeRemediatedMessage` and `truncateEchoed` are no longer exported.
  **Upgrade action:** use `@effected/mcp`'s `ToolFailure.message(raw,
  remediation)` and `ToolFailure.truncate(value, limit?)` in their place.
* `Remediation` (`{ hint, suggestedTool? }`) is replaced by
  `@effected/engine`'s `Remediation`, which additionally accepts an optional
  `suggestedArgs?: Record<string, unknown>`. Every `McpToolError` member's
  schema now accepts that key. `Remediation` is now re-exported from
  `@effected/engine`, not declared by this package.

## Bug Fixes

* A stdin line that is not valid JSON now gets a JSON-RPC `-32700` reply and the server keeps serving, instead of wedging permanently on the first bad line.
* Valid JSON that is not a JSON-RPC request or notification (for example a bare `null`) now gets a JSON-RPC `-32600` reply and the server keeps serving.
* An unexpanded literal `${CLAUDE_PROJECT_DIR}` placeholder in the environment is now ignored rather than used as the project root, so a host that leaves the variable unexpanded on some launch paths falls through to the next candidate. Likewise, an empty or whitespace-only `OKFIT_PROJECT_DIR` or `CLAUDE_PROJECT_DIR` is now skipped instead of used as-is -- previously `OKFIT_PROJECT_DIR=""` was returned verbatim, since `??` does not skip an empty string. `OKFIT_PROJECT_DIR` still takes precedence over `CLAUDE_PROJECT_DIR`, and the working directory is used only when both keys are unset, empty/whitespace-only, or an unexpanded placeholder.
