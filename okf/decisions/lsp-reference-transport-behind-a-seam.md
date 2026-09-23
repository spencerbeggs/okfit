---
type: Decision
title: The language server runs the reference vscode-languageserver library behind an Effect transport seam
description: '@okfit/lsp wraps the reference vscode-languageserver library behind an eight-member LspTransportShape rather than writing an Effect-native LSP transport or adopting an MCP-TypeScript-SDK-style route, so a later transport can replace it without touching a feature.'
status: draft
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-23T03:06:44Z
  body_sha256: 26efa68d1ad451ab19cce9a201006428a2bd92da418560d91e3fd17689ee00c1
---

# The language server runs the reference vscode-languageserver library behind an Effect transport seam

## Context

`@okfit/lsp` needed a JSON-RPC transport implementing the Language Server
Protocol's `initialize`/`initialized`/`shutdown`/`exit` lifecycle,
request/notification dispatch, and Content-Length framing over stdio. No
Effect-native LSP transport exists, unlike MCP, where
`effect/unstable/ai/McpServer` already gave [MCP](../modules/mcp.md) an Effect-native
option — see [The MCP server is Effect-native and speaks the legacy
protocol era](mcp-effect-native-legacy-era.md). The reference
`vscode-languageserver` library is the de facto standard every other LSP
server in the ecosystem is built on.

## Decision

`@okfit/lsp` runs the reference `vscode-languageserver` library behind a
small seam, `LspTransportShape` (`src/protocol/LspTransport.ts`): eight
members — `onInitialize`, `onInitialized`, `onShutdown`, `onRequest`,
`onNotification`, `sendNotification`, `sendRequest`, `listen` — sized to
what the reference library special-cases itself. The library treats
`initialize`, `shutdown`, and `exit` as lifecycle events with their own
hooks and its own process-exit behaviour, distinct from an ordinary
request or notification, so the seam gives each its own member rather than
routing all three through `onRequest`/`onNotification` generically.
`src/protocol/reference.ts#makeReferenceTransport` is the seam's only
implementation: it builds the connection on the library's server core
(`createConnection`) with its own watchdog, because the library's node
entry calls `process.exit` after `onExit` and on raw-stream `end`/`close`,
which would make `listen` never resolve with a `ListenOutcome` for
`main.ts` to map to an exit code itself. Every feature (`documentSync`,
`diagnostics`) codes against the seam and the engine, never the library
directly; `__test__/boundaries.test.ts` enforces that only
`protocol/reference.ts`, `main.ts`, and the type-only `protocol/types.ts`
import from `vscode-languageserver*`.

## Alternatives rejected

An Effect-native transport now: no Effect LSP implementation exists to
build on, and writing one from scratch would make `@okfit/lsp` the sole
client of its own framing decisions under Claude Code's crash rule (a
stray stdout byte reads as a crash) with no ecosystem precedent to lean
on — too much risk for a first release whose scope is diagnostics only.
The MCP TypeScript-SDK-style route `mcp-effect-native-legacy-era.md`
rejected for MCP has no LSP equivalent to weigh in the first place: there
is no separately maintained "LSP SDK" alongside the reference library the
way the MCP TypeScript SDK sits alongside `effect/unstable/ai/McpServer`.

## Consequences

A feature that needs a protocol method the seam does not yet expose adds
it to the seam first, never imports the library directly to route around
it. A future transport — Effect-native or otherwise — is done when
`__test__/protocol/reference.test.ts` passes unchanged against it: the
contract is pinned to that suite, not to any implementation detail of the
reference transport. The seam is exactly eight members because the
reference library's own special-casing of `initialize`, `shutdown`, and
`exit` set that shape; a transport with a flatter lifecycle would not need
to preserve it.

## Notes toward the Effect-native transport

Phase 8 of [An @okfit/lsp language server and a VS Code extension over the
shared engine](../roadmaps/lsp-server-and-vscode-extension.md) extends this
section. Starting points recorded here so that phase does not have to
rediscover them:

- Content-Length framing belongs on `RpcSerialization`, the same layer
  Effect's own RPC stack already frames on, rather than a hand-rolled
  reader.
- LSP methods (`textDocument/didOpen`, `textDocument/publishDiagnostics`,
  and so on) become tags on an `RpcGroup`, mirroring how Effect's own MCP
  server maps JSON-RPC method names onto RPC tags with pluggable framing
  — the same shape this package's own [MCP
  server](../modules/mcp.md) sibling already proves out for a different protocol.
- The `exit`-without-`shutdown` exit-code rule (`1` only when
  `reason: "exit"` and `shutdownReceived: false`) is a `main.ts`-level
  concern, not a transport one, and carries over unchanged to any future
  transport.
- The stdin-close rule — an `end`/`close` on stdin before `exit` drains
  buffered messages then resolves `"closed"`, never assumes the
  connection died mid-message — has to be reproduced by whatever framing
  layer replaces the current `PassThrough`-plus-sentinel drain
  (`src/protocol/reference.ts`), since it is a Node stream-timing fact
  about `vscode-jsonrpc`'s async dispatch, not a library implementation
  detail specific to it.
