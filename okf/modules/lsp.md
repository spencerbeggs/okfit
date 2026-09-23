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
  at: 2026-09-23T08:34:50Z
  body_sha256: 6256c33a2833fb3fa598228231e9349ef2545ea370947e7bc7cd922426d7648f
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
carried to a second front end. Phase 4 (2026-09-23) added precise
diagnostic ranges, config reload, and navigation (hover, document links,
definition, references, workspace symbols); code actions remain a later
roadmap phase, not this package.

## Capabilities

`initialize` advertises `documentLinkProvider: { resolveProvider: false }`,
`definitionProvider: true`, `referencesProvider: true`,
`hoverProvider: true`, and `workspaceSymbolProvider: true`, alongside the
diagnostics push the server has offered since phase 3.

## Navigation

Every navigation handler answers from the folder's last revalidated
snapshot (`session.bundle()`/`session.graph()`); none of them trigger a
revalidate or wait on the scheduler, and before a folder's first
revalidate completes they answer `null`/`[]` rather than hang.

- `textDocument/documentLink` returns one link per edge in the open
  file: a concept or file target resolves to that target's absolute path
  as a URI, a raw URL stays a link to itself, and a `missing` target is
  omitted.
- `textDocument/definition` resolves the edge at the request position to
  its target concept's definition location — the H1 heading's range when
  it has one, else the frontmatter block, else `0:0` — and `null` off an
  edge.
- `textDocument/references` returns one `Location` per edge that points
  at the concept under the cursor (self-loop edges excluded), plus the
  definition location itself when `context.includeDeclaration` is set.
- `textDocument/hover` returns `null` off any recognised position, and
  otherwise a markdown `MarkupContent`: on a link or path-field edge, the
  target's title, type, status, trust tier and staleness (tier and
  staleness computed from `Derive`, given `now`); on the `type:` value,
  that type's description and guidance from the config vocabulary; on a
  top-level frontmatter field key, that field's description.
- `workspace/symbol` returns one `SymbolInformation` per concept across
  every live session, merged, filtered by a case-insensitive substring
  match over id and title (an empty query returns all), capped at 200
  results and sorted by id.

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
  `didClose` schedule `edit`. The scheduler's debounce carries a
  `maxWait` ceiling (default 1 s, measured from the first `schedule` of
  an idle scheduler), so a steady stream of edits still publishes rather
  than debouncing forever.
- The registry holds one session per resolved bundle root, shared and
  reference-counted across every workspace folder that resolves to it:
  two folders resolving to the same `okf/` share one session rather than
  each building its own. The server registers no file watchers. When a
  client sends `workspace/didChangeWatchedFiles`, a change schedules
  `full` on every live session. A config discovery file rebuilds that
  root's session instead, once, however many folders share it: the old
  session is disposed (its open document overlays carried into the fresh
  one, re-resolving every attached folder), a full revalidate is
  scheduled on the rebuilt session, and every URI the dropped session
  last published non-empty receives `[]` exactly once. A folder removal
  disposes its root's session only when it was the last folder attached
  to that root; `workspace/didChangeWorkspaceFolders` removing a folder
  that shares a root with another live folder clears nothing. `rebuild`
  is keyed by bundle root, not folder, and a lookup for a folder whose
  root is mid-build waits on that build, never on a lock.
- A folder whose config fails to load logs one warning per distinct
  error and is retried on `didOpen`, `didSave` and any watched-file
  change under it, so fixing the config and saving recovers it; its
  diagnostics have already been cleared by the dispose above.
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
  — discharged in phase 4 by the config reload rule above.
- [Two narrow interrupt windows in the LSP session registry are
  documented, not
  closed](../limitations/lsp-registry-interrupt-windows.md) — the
  `rebuild` swap-then-dispose gap and a folder build's make-then-install
  gap, both accepted rather than fixed.
