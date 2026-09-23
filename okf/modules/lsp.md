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
  at: 2026-09-23T22:40:12Z
  body_sha256: 5c895bffbb3d54eee55ccf23b342d6c0a481cdeae924ad4bda601af8734602d2
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
definition, references, workspace symbols); phase 5 (2026-09-23) added
code actions, commands, and inlay hints -- every edit they offer is
computed over the byte-range splice machinery, never a re-serialisation --
see [Frontmatter splices are a shared engine surface for the CLI's verify
and the language server's
actions](../decisions/engine-frontmatter-edits-shared-surface.md).

## Capabilities

`initialize` advertises `documentLinkProvider: { resolveProvider: false }`,
`definitionProvider: true`, `referencesProvider: true`,
`hoverProvider: true`, `workspaceSymbolProvider: true`,
`codeActionProvider: { codeActionKinds: OKFIT_CODE_ACTION_KINDS }`,
`executeCommandProvider: { commands: OKFIT_COMMANDS }`, and
`inlayHintProvider: true`, alongside the diagnostics push the server has
offered since phase 3. `features/names.ts`'s `OKFIT_COMMANDS`
(`okfit.lsp.setStatus`, `okfit.lsp.markVerified`, `okfit.lsp.revalidate`)
and `OKFIT_CODE_ACTION_KINDS` (`quickfix`, `okfit.status`, `okfit.verify`)
are the exact strings both `server.ts` and the VS Code extension agree on,
without either importing the other. The command ids sit under `okfit.lsp.`
because `vscode-languageclient` registers every advertised id as a VS Code
command: an id the extension also contributes (its own `okfit.setStatus`,
`okfit.markVerified`) throws "command already exists" while the client
initializes, and the server never starts.

## Code actions, commands, and inlay hints

`registerCodeActions` (`src/features/actions.ts`) answers
`textDocument/codeAction` for a concept in its session's last-loaded
snapshot. On a `status-missing` diagnostic it offers `Set status: draft`
(preferred) and `Set status: stable` as `quickfix` actions. When the request
range touches the frontmatter block, or `context.only` names the kind, it
also offers one `Set status: <status>` action (kind `okfit.status`) per
status the raw frontmatter `status` is not already -- all three when there
is no explicit status -- and one `Mark verified by <actor>` action (kind
`okfit.verify`) when a human actor resolves and the concept is neither a
draft nor already verified by that actor; the actor is cached per session
handle. `registerCommands` (`src/features/commands.ts`) answers
`workspace/executeCommand` for the three `OKFIT_COMMANDS`:
`okfit.lsp.setStatus [uri, status]` and `okfit.lsp.markVerified [uri]`
compute a `TextEdit` and send it to the client with `workspace/applyEdit`,
answering the client's own result verbatim; `okfit.lsp.revalidate
[rootUri?]` schedules a `full` revalidate on one named bundle root or every
live session and answers the root URIs revalidated. Both features share
`features/edits.ts`: `editTarget` reads the document's current text and
version from the diagnostics feature's open-document memory (else the file
as loaded, version `null`), `statusTextEdits`/`verifiedTextEdits` wrap
[Engine](engine.md)'s `FrontmatterEdits.status`/`.verified` over that text,
and `versionedEdit` sends the result as `documentChanges` carrying the
version. A command's edit goes over `workspace/applyEdit`, so a client
whose buffer has moved on refuses a stale one; a code action's edit carries
no version on the client side (`vscode-languageclient` and VS Code both
drop it), so it stays safe only because it is computed from the current
buffer at request time. `registerInlayHints` (`src/features/inlayHints.ts`)
answers `textDocument/inlayHint` with up to two hints per concept, computed
by the pure `hintsFor(concept, now)`: a trust/staleness hint (`unverified`,
`machine-confirmed`, or `human-reviewed by <by>`, `· stale` appended when
stale) anchored after the `status:` value when present, else after
`type:`; and, only when `generated.at` is set, an age hint (`today`, `1 day
ago`, `N days ago`) after its value. All three features answer `[]`/fail
closed the same way navigation does: a missing session, an unloaded
bundle, a non-`file:` URI, or a path outside every bundle root, never a
hang.

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

## Custom methods

`registerConcepts` (`src/features/concepts.ts`) wires `okfit/concepts` onto
the transport, and `notifyBundleChanged` sends `okfit/bundleChanged` --
okfit's own protocol extensions for an editor's concept explorer, named
with the `okfit/` prefix since the LSP specification reserves `$/` for its
own extensions and leaves vendor prefixes to implementations. The
[VS Code Extension](vscode-extension.md)'s OKF Concepts tree view and
Language Status item are the first consumer.
`INITIALIZE_RESULT.capabilities.experimental` advertises `{ okfitConcepts:
true }` so a client can feature-detect the pair before calling either.
`okfit/concepts` answers from every live session's last-loaded bundle
without triggering or waiting on a revalidate; `okfit/bundleChanged` is
sent from the registry's own revalidate and dispose callbacks, after
diagnostics for the same change have already published, so a client that
re-fetches `okfit/concepts` on this notification never races the
diagnostics it would otherwise cross-reference.

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
- [VS Code Extension](vscode-extension.md) — the language client and
  concept explorer built on this server, including `okfit/concepts` and
  `okfit/bundleChanged`.
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
