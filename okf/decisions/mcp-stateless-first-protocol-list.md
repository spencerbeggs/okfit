---
type: Decision
title: The MCP server is Effect-native and lists the stateless 2026-07-28 adapter first
description: The okfit-mcp server stays on effect/unstable/ai/McpServer and declares three protocol adapters, the stateless 2026-07-28 revision first and the two stateful ones behind it, with an agent-facing instructions string surfaced on both initialize and server/discover.
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-24T15:35:44Z
  body_sha256: af58bdd37c1bd70a70d607eca0fe69f44034ee3f8e41159f8d0495733ac5ae7a
status: draft
supersedes: mcp-effect-native-legacy-era.md
sources:
  - id: server-ts
    resource: ../../packages/mcp/src/server.ts
  - id: mcp-runtime
    resource: ../../.repos/effect/packages/effect/src/unstable/ai/internal/mcpRuntime.ts
  - id: mcp-server-ts
    resource: ../../.repos/effect/packages/effect/src/unstable/ai/McpServer.ts
  - id: claude-code-capture
    resource: stdin capture of Claude Code 2.1.278 launching okfit-mcp
    author: human:spencer
    last_modified: 2026-09-19T00:00:00Z
---

# The MCP server is Effect-native and lists the stateless 2026-07-28 adapter first

## Context

The superseded Decision chose `effect/unstable/ai/McpServer` over the MCP
TypeScript SDK and declared `[v2025_11_25, v2025_06_18]` because, at the
time, Effect shipped no adapter newer than `2025-11-25`. Effect
`4.0.0-rc.116` (the `catalog:effect` pin) ships `McpProtocol.v2026_07_28`,
an adapter for the stateless MCP revision (SEP-2575): there is no
`initialize` and no session; a client opens with `server/discover` and
every request self-identifies through
`params._meta["io.modelcontextprotocol/protocolVersion"]`. The same
release made `instructions` a first-class `layerStdio` option again. Both
changes reopened the protocol-list question the superseded Decision had
settled for the older era.

## Decision

`@okfit/mcp` remains built on `effect/unstable/ai/McpServer` at the
`catalog:effect` pin; nothing about the SDK comparison changed. Every tool
and resource still obeys the era-agnostic constraints the superseded
Decision stated, carried forward verbatim: no `initialize`-time state
beyond what Effect keeps internally; no server-initiated requests; no
reliance on sessions; paging carried in tool arguments (`limit`/`offset`),
never a protocol-level cursor; and every tool a pure request/response with
no streaming or elicitation. Those constraints are what made a stateless
adapter a one-line addition.

`ServerLayer` declares
`protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18]`,
stateless first.[^server-ts] The two stateful adapters stay because an
`initialize` request matches stateful adapters only: a server offering
only `2026-07-28` answers `initialize` with `METHOD_NOT_FOUND` (`-32601`),
which would lock out every client that still opens that way. Array order
is load-bearing under Effect's runtime rules:[^mcp-runtime] at most one
stateless adapter is allowed (a second fails the layer with
`Cause.IllegalArgumentError`); a request carrying `_meta.protocolVersion`
routes to that adapter; a sessionless request with no `_meta` falls to
`protocols[0]`; and `server/discover` advertises every listed adapter in
`supportedVersions`, so a modern client sees
`["2026-07-28", "2025-11-25", "2025-06-18"]`.

`server.ts` exports `SERVER_INSTRUCTIONS`, a string passed as
`layerStdio`'s `instructions` option and surfaced verbatim in both the
`initialize` result (`2025-11-25` / `2025-06-18`) and the
`server/discover` result (`2026-07-28`); the e2e tests assert identity,
not a substring. It is the agent-facing orientation, distinct from the
one-line `description`: the tools are read-only; start with
`describe_vocabulary`, then `list_concepts`; ids are bundle-relative paths
without `.md`; every successful `tools/call` carries `structuredContent`
plus a JSON rendering in `content[0].text`; a failure is `isError: true`
with the message and remediation hint in `content[0].text` and no
`structuredContent`.

## Alternatives rejected

Offering only `2026-07-28`: rejected because `initialize` would return
`METHOD_NOT_FOUND`, and the measured clients (below) still open with it
by default. Keeping the two-adapter list and waiting for clients to move:
rejected because the stateless adapter costs one array entry and the
era-agnostic constraints already hold, so there is nothing to wait for.
Placing a stateful adapter first: rejected because `protocols[0]` is the
fallback for a sessionless request with no `_meta`, which is exactly the
shape a stateless client sends, and a stateless request must not fall to
a stateful adapter.

## Consequences

Measured against Claude Code 2.1.278 with stdin tee'd:[^claude-code-capture]
by default or with `MCP_PROTOCOL_NEGOTIATION=legacy` it opens with
`initialize` (`protocolVersion` `2025-11-25`), then
`notifications/initialized`, then `tools/list`; its debug log reports
`protocolEra: legacy` and the negotiated version is `2025-11-25`. With
`MCP_PROTOCOL_NEGOTIATION=auto` it opens with `server/discover`, then
`subscriptions/listen`, then `tools/list`; the negotiated version is
`2026-07-28` and the log reports `protocolEra: modern`. Both paths called
a tool successfully. Copilot, Cursor and the MCP Inspector still
`initialize` unconditionally, so the stateful adapters are load-bearing
for them too.

On `2026-07-28` every result, `tools/call` included, is wrapped in the
stateless frame: `_meta["io.modelcontextprotocol/serverInfo"]`,
`resultType: "complete"`, `ttlMs`, `cacheScope`, then the result fields.
Invalid params surface per revision: a JSON-RPC `-32602` error on
`2025-06-18`, an `isError: true` result on `2025-11-25` and `2026-07-28`.
That split is the runtime's own and is a per-revision expectation, not a
bug.

A declared tool failure (any `McpToolError` member, under
`failureMode: "error"`) reaches the wire as `isError: true` with only its
message text in `content[0].text` and `structuredContent` never
populated, so every member's message still carries its remediation hint
inline. New in rc.116, `registerToolkit` renders that declared branch
without any log line; only an internal, unexpected failure goes through
`Effect.logError` and the `ErrorReporter`.[^mcp-server-ts] This package
has no port of that code path -- it runs core's `registerToolkit`
unchanged, now reached through `@effected/mcp`'s `McpToolkit.layer`
rather than core's own `McpServer.toolkit` called directly (see [okfit's
front ends build on @effected/{engine,cli,mcp} rather than hand-rolled
equivalents](front-ends-adopt-the-effected-kit.md)) -- so nothing of the
declared-failure rendering was rebased, but a test that wants to prove
stderr log routing can no longer trigger it through a declared failure;
the e2e that did so now targets the boot-time `could not load the
bundle` `logError` in `resources/conceptResource.ts`.

`McpToolkit.layer` also closes every strict tool's served `inputSchema`
(`additionalProperties: false` at every object node) and, on an unknown
argument, fails with one `InvalidParams` naming every unknown key at
every depth rather than only the first, which is what core's own
`registerToolkit` reports on its own. `McpStdio.layer`, used here in
place of hand-wiring `McpServer.layerStdio` directly, additionally
answers a stdin line that is not JSON with a JSON-RPC `-32700` and keeps
serving, and JSON that is not a JSON-RPC message with `-32600` and keeps
serving -- both new behaviour this package did not have before adopting
the kit.

The second Effect limitation the superseded Decision recorded is
unchanged: a resource URI template's parametric segment cannot span a
`/`, so concepts remain static per-concept resources, one literal URI
each, registered once at boot.

[^server-ts]: `../../packages/mcp/src/server.ts`
[^mcp-runtime]: `../../.repos/effect/packages/effect/src/unstable/ai/internal/mcpRuntime.ts`
[^mcp-server-ts]: `../../.repos/effect/packages/effect/src/unstable/ai/McpServer.ts`
[^claude-code-capture]: stdin capture of Claude Code 2.1.278 launching okfit-mcp, 2026-09-19
