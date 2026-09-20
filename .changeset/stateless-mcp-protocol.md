---
"@okfit/mcp": minor
---

## Features

### MCP protocol 2026-07-28 and server instructions

`okfit-mcp` now offers three protocol adapters, newest first: `2026-07-28`, `2025-11-25` and `2025-06-18`. `2026-07-28` is the stateless revision (MCP SEP-2575): a client opens with `server/discover` instead of `initialize`, every request self-identifies through `params._meta`, and every result is wrapped in the stateless frame (`resultType`, `_meta["io.modelcontextprotocol/serverInfo"]`, `ttlMs`, `cacheScope`). The two stateful adapters stay, so a client that opens with `initialize` is served exactly as before.

Measured against Claude Code 2.1.278: by default (or with `MCP_PROTOCOL_NEGOTIATION=legacy`) it opens with `initialize` and negotiates `2025-11-25`; with `MCP_PROTOCOL_NEGOTIATION=auto` it opens with `server/discover` and runs on `2026-07-28`. Both paths call tools successfully.

The server now also registers `instructions`, an agent-facing orientation (which tool to call first, the id format, the success and failure envelopes), surfaced in both the `initialize` and the `server/discover` results. It is exported as `SERVER_INSTRUCTIONS`.

* Invalid tool parameters remain a JSON-RPC `-32602` error on `2025-06-18` and an `isError: true` result on `2025-11-25` and `2026-07-28`; this is the per-revision behaviour of the runtime, not a change in this release.
* Under effect `4.0.0-rc.116` a declared tool failure (`isError: true`, message in `content[0].text`) is no longer accompanied by a log line on stderr; only an internal failure is logged.
