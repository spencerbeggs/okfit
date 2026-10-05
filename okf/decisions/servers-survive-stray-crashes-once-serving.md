---
type: Decision
title: The language and MCP servers survive a stray crash once serving, and exit on one before
description: "okfit-lsp and okfit-mcp run under the kit's crash guards with the exitBeforeConnect policy for both uncaught exceptions and unhandled rejections: a stray error before the server is serving exits 1, and once serving it is logged on stderr and the server keeps answering."
status: stable
tags:
  - architecture
  - observability
sources:
  - id: lsp-main
    resource: ../../packages/lsp/src/main.ts
  - id: mcp-main
    resource: ../../packages/mcp/src/main.ts
  - id: issue-191
    resource: https://github.com/spencerbeggs/okfit/issues/191
generated:
  by: okfit/claude-code
  at: 2026-10-05T22:58:46Z
  body_sha256: ef0014c6c62a639d693923030795673556f29ef00e8761fad9c7589c06e0b61a
verified:
  - by: human:spencer
    at: 2026-10-05T23:03:56Z
---

# The language and MCP servers survive a stray crash once serving, and exit on one before

## Context

Both long-lived servers install process-level crash guards before their module
graph loads: `okfit-mcp` through `McpGuard.run` (`@effected/mcp/guard`) and
`okfit-lsp` through `ProcessGuard.run` (`@effected/engine/guard`). The guards
catch what nothing else catches: an `uncaughtException` or
`unhandledRejection` raised outside any request, from a timer, a watcher or a
library callback. A failure inside a request handler never reaches them;
Effect turns it into an error response.

The guard's policy decides what such a stray error does. The kit's options are
to always exit, to exit only before the server is serving
(`exitBeforeConnect`), or, for rejections, to only log.

## Decision

Both servers use `exitBeforeConnect` for uncaught exceptions **and** unhandled
rejections:

- **Before the server is serving** (MCP: the whole server layer is built;
  LSP: the transport is built and reading stdin, where `main.ts` calls
  `markConnected()`), a stray error means a broken boot. The process reports it
  on stderr with its `okfit-mcp:` / `okfit-lsp:` prefix and exits 1. A `load()`
  that rejects is reported as `startup failed` and exits 1 under any policy.
- **Once serving**, a stray error is logged on stderr and the server keeps
  answering.

## Alternatives rejected

- **Always exit.** A server that dies mid-session costs the client
  everything. The MCP client deregisters all six tools. Claude Code does not
  reliably respawn a language server that exits, so okfit-lsp would go
  silent until the session restarts. VS Code restarts a crashed server, but
  gives up for the window after five crashes in three minutes.
- **`onRejection: "log"`** (the kit's usual default for rejections). A
  rejection during boot would then be logged and the half-built server would
  never answer. Exiting before connect keeps a broken boot loud.

## Consequences

- **The MCP server has no state to corrupt.** Every tool is read-only and
  reloads the bundle from disk on each call.
- **The language server does hold state.** Open documents, the loaded config
  and bundle, and its published diagnostics live in memory, and a stray error
  could interrupt an update partway through. The accepted worst case is stale
  diagnostics until the next edit or save revalidates from the document text.
  Nothing is written to disk from that state, so surviving never produces
  wrong data, only possibly stale findings, and those still beat none.
- **A surviving crash is visible.** It is logged on stderr with the server's
  prefix, which lands in the editor's output channel or Claude Code's logs.
- **Both halves are pinned by e2e tests.** The `crash-guards` suites in
  `packages/mcp` and `packages/lsp` drive both halves of the policy against
  the built bins, through the `OKFIT_MCP_TEST_INJECT_CRASH` /
  `OKFIT_LSP_TEST_INJECT_CRASH` knobs, which are parsed by the kit's
  `parseInjectCrash`.
