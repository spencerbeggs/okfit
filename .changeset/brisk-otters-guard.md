---
"@okfit/mcp": minor
---

## Breaking Changes

Every served tool's `inputSchema` is now closed (`additionalProperties: false`
at every object node), and a `tools/call` whose arguments include a key the
schema does not declare now fails with a single `InvalidParams` error naming
every unknown key at every depth, instead of the argument being silently
dropped.

**Upgrade action:** send only a tool's declared arguments. A client that
previously sent extra or speculative keys alongside a valid call will now get
a hard failure instead of having those keys ignored.

```jsonc
// Before: `extra` was silently dropped, the call succeeded
{ "name": "get_concept", "arguments": { "id": "decisions/cli-exit-codes", "extra": 1 } }

// Now: fails with InvalidParams naming "extra"
```

## Bug Fixes

* A stdin line that is not valid JSON now gets a JSON-RPC `-32700` reply and the server keeps serving, instead of wedging permanently on the first bad line.
* Valid JSON that is not a JSON-RPC request or notification (for example a bare `null`) now gets a JSON-RPC `-32600` reply and the server keeps serving.
* An unexpanded literal `${CLAUDE_PROJECT_DIR}` placeholder in the environment is now ignored rather than used as the project root, so a host that leaves the variable unexpanded on some launch paths falls back to the working directory. `OKFIT_PROJECT_DIR` still takes precedence over both.
