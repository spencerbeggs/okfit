---
type: Module
title: LSP
description: The okfit-lsp language server, publishing engine diagnostics for a discovered bundle over stdio to Claude Code and any LSP client.
status: stable
resource: ../../packages/lsp
kind: package
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-23T04:04:54Z
  body_sha256: 8a4e0662255072b7dac898b85a2f40f105bc17c8649efb1297ecb2633d50a45f
---

# LSP

## Purpose

`@okfit/lsp` is the `okfit-lsp` bin: a Language Server Protocol server over
stdio that publishes [Engine](engine.md)'s validate diagnostics for a
discovered OKF bundle into any LSP client, Claude Code included, without a
tool call. The `.md` binding is the client's own registration (the Claude
Code plugin manifest's `extensionToLanguage`); this server answers for
any document under a discovered bundle root. It discovers a bundle per
workspace folder the same way the CLI and MCP server do, and republishes
diagnostics as
documents open, change, save, or close. It
writes nothing to the bundle, ever — the same promise [MCP](mcp.md) makes,
carried to a second front end. Diagnostics only; navigation, hover, and
code actions are later roadmap phases, not this package.

## The transport seam

Features never import `vscode-languageserver` directly; they code against
`LspTransportShape` (`src/protocol/LspTransport.ts`), which has eight
members: `onInitialize`, `onInitialized`, `onShutdown` (the lifecycle
hooks), `onRequest`, `onNotification` (handler registration, order
independent), `sendNotification`, `sendRequest`, and `listen` (starts
reading and resolves once with a `ListenOutcome` when the connection
ends). `ListenOutcome.reason` is `"exit"` or `"closed"`, and
`shutdownReceived` says whether `shutdown` arrived first; the transport
never exits the process itself, so `main.ts` alone maps the outcome to an
exit code. `src/protocol/reference.ts#makeReferenceTransport` is the only
implementation today, built on the reference `vscode-languageserver`
library with its own watchdog so the library's own `process.exit`-on-exit
behaviour never fires; a future transport is done when
`__test__/protocol/reference.test.ts` passes unchanged against it — see
[The language server runs the reference vscode-languageserver library
behind an Effect transport
seam](../decisions/lsp-reference-transport-behind-a-seam.md).

## Publishing rules

- `didOpen`/`didSave` schedule the `full` revalidate tier; `didChange`/
  `didClose` schedule `edit`.
- The server registers no file watchers. When a client sends
  `workspace/didChangeWatchedFiles`, a change schedules `full` on every
  live session. A config discovery file is the exception: it drops that
  folder's session and republishes nothing until the next document
  event. Claude Code sends no watched-file events, so a config edit
  there needs a session restart. See [The phase 3 language server does
  not reload a changed config or clear a dropped session's
  diagnostics](../limitations/no-config-reload-in-phase-3.md).
- A folder whose config fails to load logs one warning per distinct
  error and is retried on `didOpen`, `didSave` and any watched-file
  change under it, so fixing the config and saving recovers it.
- `--clientProcessId` is accepted, and the server still exits on `exit`.
  The transport's own liveness signal is the input stream closing; the
  reference library's node entry separately polls that process and
  exits with code 1 if it disappears first.
- One `textDocument/publishDiagnostics` per file in the engine's `changed`
  map, and nothing else: an unchanged file is not republished, an
  emptied file publishes `[]`, and a file that is not open in the editor
  still publishes.
- A bundle-level diagnostic (engine file `""`) publishes against the
  bundle root's `index.md`.
- A revalidate that fails logs one warning naming the bundle root and
  publishes nothing.
- A non-`file:` URI, and any document outside every discovered bundle
  root, is ignored; a folder added later serves the next event for it.
- Notification work runs on one queue drained by a single fiber, in
  arrival order, so a `didChange` can never overtake an earlier
  `didOpen`; `shutdown` drains that queue up to its own arrival, then
  waits for every scheduler to settle, so everything sent before it is
  published before the response.

## Boundaries

No file under `src/` reads `process` except `bin.ts`, `main.ts`, and
`version.ts`'s build-time constant; no file under `src/` writes to
stdout — the transport is the only writer, and only through the stream
`main.ts` hands it; only `src/protocol/reference.ts`, `src/main.ts`, and
the type-only `src/protocol/types.ts` may import from
`vscode-languageserver*`. `__test__/boundaries.test.ts` enforces all
three by scanning `src/`.

## Links

- [Engine](engine.md) — `BundleSession`, the overlay filesystem, and the
  revalidate this package schedules and calls.
- [Plugin](plugin.md) — the meta-package whose third bin shim launches
  this server.
- [Claude Code Plugin](claude-code-plugin.md) — registers
  `lspServers.okfit` and loads this server lazily.
- [The language server runs the reference vscode-languageserver library
  behind an Effect transport
  seam](../decisions/lsp-reference-transport-behind-a-seam.md)
- [The phase 3 language server does not reload a changed config or clear
  a dropped session's diagnostics](../limitations/no-config-reload-in-phase-3.md)
  — the edge of the publishing rules above.
