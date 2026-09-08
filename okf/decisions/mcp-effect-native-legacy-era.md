---
type: Decision
title: The MCP server is Effect-native and speaks the legacy protocol era
description: The okfit-mcp server is built on effect/unstable/ai/McpServer rather than the MCP TypeScript SDK, and negotiates the 2025-11-25 protocol era rather than the newest published one.
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-07T00:13:55Z
status: stable
verified:
  - by: human:spencer
    at: 2026-09-07T20:49:07Z
---

# The MCP server is Effect-native and speaks the legacy protocol era

## Context

`@okfit/mcp` had to choose between the official MCP TypeScript SDK and
Effect's own native `effect/unstable/ai/McpServer`, and, independently,
which protocol era(s) to negotiate. Claude Code's v2 runtime is
dual-era: it speaks a newer protocol where a server supports it but falls
back to the older `initialize`-time negotiation for a stdio server that
does not. As of 2026-09-06, Effect's `main` branch ships adapters only
through `2025-11-25` — there is no `2025-06-18`-successor `2026-07-28`
adapter on `main` yet.

## Decision

`@okfit/mcp` is built on `effect/unstable/ai/McpServer`, at the version
pinned by `catalog:effect`. `ServerLayer` declares
`protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18]`, newest
first — array order is load-bearing, since the protocol registry falls
back to `protocols[0]` for an unrecognised client version. Every tool and
resource obeys a set of era-agnostic constraints stated here verbatim so
a future protocol bump never has to rediscover them: no `initialize`-time
state beyond what Effect keeps internally; no server-initiated requests;
no reliance on sessions; paging carried in tool arguments (`limit`/
`offset`), never a protocol-level cursor; and every tool a pure
request/response with no streaming or elicitation.

## Alternatives rejected

The MCP TypeScript SDK directly: it is protocol-current but was freshly
released relative to this decision, and adopting it would need a runtime
bridge translating each Effect-native handler's `Effect` value into the
SDK's callback shape, plus a second schema system (the SDK's own Zod/JSON
Schema surface) alongside Effect's `Schema`, for no gain this server's
read-only, era-agnostic tool set needs.

## Consequences

Re-pinning to a future adapter, once Effect ships one, is a one-line
`protocols` change in `server.ts`; until then, a newer client silently
negotiates down to `2025-11-25` — a currency gap, not an outage, since
every constraint above holds regardless of era. Two Effect limitations
shaped the surface directly: a declared tool failure reaches the wire as
`isError: true` with only its message text, `structuredContent` never
populated for it, so every `McpToolError` member's message carries its
remediation hint inline rather than as a separate field; and a resource
URI template's parametric segment cannot span a `/`, so a nested concept
id (e.g. `metrics/revenue`) never matches a templated `okf://concept/{id}`
— concepts are instead exposed as static per-concept resources, one
literal URI each, registered once when the server starts.
