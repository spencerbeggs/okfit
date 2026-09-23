---
type: Module
title: VS Code Extension
description: The okfit VS Code extension -- a language client for @okfit/lsp plus a concept explorer, Language Status item and commands, published to the Marketplace and Open VSX.
status: draft
resource: ../../vscode
kind: plugin
tags:
  - dx
  - release
generated:
  by: okfit/claude-code
  at: 2026-09-23T21:50:18Z
  body_sha256: c81f07541fca2135fc1a35d74fc074635acb7523c3f689113662d2174f7fde8b
---

# VS Code Extension

## Purpose

`@okfit/vscode-extension` (Marketplace id `okfit`, publisher `okfit`) is an
editor extension, not an agent plugin: it runs inside VS Code's extension
host and talks to a human through views, a status item and commands, where
[Claude Code Plugin](claude-code-plugin.md) runs inside an agent host and
talks to a model through hooks and MCP tools. It lives at the workspace
root under `vscode/`, sibling to `packages/*` and `plugins/claude-code`
rather than inside either — see [The VS Code extension lives at vscode/,
not under plugins/ or
packages/](../decisions/vscode-extension-at-repo-root.md). It wraps
[LSP](lsp.md)'s `okfit-lsp` server: diagnostics, hover, navigation and
workspace symbols come from the language client VS Code already knows how
to render; the concept explorer, Language Status item and commands are
this extension's own additions over `okfit-lsp`'s protocol extensions
(`okfit/concepts`, `okfit/bundleChanged` — see [LSP](lsp.md)'s Custom
methods).

## Layout

- `src/extension.ts` -- the extension host entry, built with
  `reactive-vscode`'s `defineExtension`: builds the file-decoration
  provider and Language Status item once per activation, starts the
  language client, feature-detects `experimental.okfitConcepts` on the
  started client before building the `ConceptsProvider` tree and its
  `TreeView` (Views and commands below), wires `updateStatus` to the
  active-editor and diagnostics events (normalizing `bundle.rootUri`
  through `vscode.Uri` before comparing it against `document.uri`), and
  serializes every client restart -- including the first `start()`, whose
  restart triggers (an `onDidChangeConfiguration` listener for an edit to
  `okfit.lsp.serverPath` on any folder, and an `onDidChangeWorkspaceFolders`
  listener) are all registered before it runs -- and the final stop on
  deactivation, through one `SerialQueue` (`vscode/src/serial-queue.ts`) so
  overlapping `stop()`/`start()` calls can never leak a client. A restart
  also disposes the outgoing client's two `FileSystemWatcher`s
  (`stopQuietly`), since `LanguageClient` never adopts them for disposal
  itself (Server resolution below).
- `src/client.ts` -- `startClient`: builds the per-folder candidate list
  with `resolveServer` (below), then tries each candidate in order --
  starting it, checking `experimental.okfitConcepts`, and falling through
  to the next candidate on a `"workspace"`-sourced candidate that starts
  without that capability or throws on `start()` (`src/next-candidate.ts`'s
  `nextCandidate` makes the capability half of that call, as a pure,
  separately tested decision) -- so a stale `okfit-lsp` in one folder's
  `node_modules/.bin` never wins for every folder in the window. A
  `"setting"`-sourced candidate is the user's explicit choice and is kept
  regardless of the capability check; only the last candidate's `start()`
  failure surfaces as an error dialog with an "Open Output" action. Each
  attempt builds its own pair of `FileSystemWatcher`s (Server resolution
  below) and disposes them itself on that attempt's failure or
  fall-through, since `vscode-languageclient` only adopts a raw
  `synchronize.fileEvents` watcher's event listeners for disposal, never
  the watcher object itself, and only after a successful `start()`. Returns
  the started `LanguageClient`, the resolved `ServerLaunch`, and those
  watchers together, so the caller can feature-detect
  `experimental.okfitConcepts`, log which source and target were actually
  used, and dispose the watchers whenever it later stops the client.
- `src/next-candidate.ts` -- `nextCandidate`: the pure `"keep"` /
  `"try-next"` decision `client.ts` applies to a just-started candidate's
  capability check (Server resolution below).
- `src/config-glob.ts` (`vscode/src/config-glob.ts:1-7`) -- `CONFIG_GLOB`:
  the okfit config-file glob shared by `client.ts`'s file-system watcher
  and the extension manifest's `activationEvents`, pinned together by
  `__test__/manifest.test.ts` so the two can never drift apart silently.
- `src/resolve-server.ts` -- `resolveServer`: the pure, priority-ordered
  candidate-list builder plus the bundled launch's own host-Node check
  (Server resolution below).
- `src/status.ts` (`vscode/src/status.ts:19-30`) -- `statusFor`: pure
  function from the active document's URI, the last `okfit/concepts`
  result and the workspace's current diagnostics to a `StatusView` (text,
  detail, severity), or `undefined` when no live bundle owns the document.
- `src/commands.ts` (`vscode/src/commands.ts:6-23`) -- `registerCommands`:
  `okfit.validateBundle` and `okfit.openConcept` (Views and commands
  below).
- `src/serial-queue.ts` -- `createSerialQueue`: a one-at-a-time async run
  queue, the mechanism behind the no-overlapping-restarts rule above.
- `src/tree/` -- the OKF Concepts explorer: `model.ts` (tree node shapes),
  `provider.ts` (`ConceptsProvider`, a `TreeDataProvider` fed by
  `okfit/concepts` and refreshed on `okfit/bundleChanged`),
  `decorations.ts` (`ConceptDecorations`, a `FileDecorationProvider` for
  status and stale badges), `wire.ts` (the `okfit/concepts` wire types,
  mirroring `packages/lsp/src/features/concepts.ts`'s `ConceptsResult`
  without importing `@okfit/lsp` itself, since the client only ever
  receives this shape over JSON-RPC).
- `server/main.ts` -- the bundled language server entry: calls
  `@okfit/lsp`'s `main`'s program with a `Distribution` shaped for the
  extension host.
- `lib/package-vsix.ts` (`vscode/lib/package-vsix.ts:1-21`) -- runs `vsce
  package --no-dependencies` against a copy of `package.json` whose `name`
  is rewritten to the Marketplace name `okfit` (the workspace package stays
  `@okfit/vscode-extension` for pnpm and changesets); the only place that
  rewrite happens, since `vsce publish --packagePath` reads the name from
  inside an already-built `.vsix`.
- `lib/assert-version.sh` (`vscode/lib/assert-version.sh:1-18`) -- asserts
  a release tag's version matches `package.json`'s `version` before the
  publish workflow packages anything.

The Layout tree above is a map, not a substitute for reading source: it
names files and their headline exports, not every symbol.

## Server resolution

One language client serves every workspace folder (VS Code's own
multi-root guidance), so `resolveServer` returns a priority-ordered
candidate list rather than a single answer -- `client.ts`'s `startClient`
tries each in turn:

1. Every folder's `okfit.lsp.serverPath`, a resource-scoped setting read
   per folder with `vscode.workspace.getConfiguration("okfit.lsp",
   folder.uri)`, if set and the path exists, in window order
   (`source: "setting"`; a missing path adds one note and is skipped
   without blocking another folder's setting), deduped by real path so two
   folders pointed at the same server -- the same literal setting value, or
   two paths that resolve to the same on-disk binary -- only candidate
   once.
2. Every folder's `<folder>/node_modules/.bin/okfit-lsp` that exists, in
   window order, deduped by real path so two folders that resolve to the
   same on-disk server (a symlink, or one nested inside the other) only
   candidate once (`source: "workspace"`).
3. The server bundled into the extension itself, `dist/server.js`, built
   from `server/main.ts` -- always available, no installation required;
   always the last candidate, so the list is never empty.

`startClient` starts the first candidate and, after `start()`, checks
`initializeResult?.capabilities.experimental?.okfitConcepts === true`.
`nextCandidate` (`src/next-candidate.ts`) makes the keep-or-fall-through
call: a `"workspace"`-sourced candidate without that capability -- a
different folder's older `okfit-lsp`, predating the concept explorer --
is stopped and the next candidate tried; a `"setting"`-sourced candidate
is the user's explicit choice and is kept regardless, leaving the
existing `okfit.serverTooOld` UI to show. A candidate whose `start()`
itself throws is logged and abandoned the same way, in favor of the next
one. Only the last candidate's outcome is final: a missing capability is
kept as-is, and a thrown error surfaces as the one error dialog with an
"Open Output" action.

Sources 1 and 2 always launch as a `command` over stdio, no PATH Node
required. Source 3 is not launched unconditionally in-process: `@okfit/lsp`
declares `engines.node >=24.11.0` (`BUNDLED_NODE_FLOOR` in
`resolve-server.ts`), and `engines.vscode: ^1.100.0` (`vscode/package.json`)
admits extension hosts whose own Node predates that -- older VS Code
releases before their host Node reached 24.11, and forks such as VSCodium
or Cursor that lag upstream -- without verifying them, since only VS Code
1.138 (Node 24.18.1 / Electron 42.10.0) has actually been probed.
`resolveServer` compares the host Node it is given (`process.versions.node`,
passed in as `hostNode` -- a pure `major.minor.patch` numeric comparison, no
dependency) against `BUNDLED_NODE_FLOOR`: at or above it, source 3 launches
as `{ kind: "module" }` in-process (`source: "bundled"`) exactly as before;
below it, it launches as `{ kind: "command", command: "node", args:
[bundledModule, "--stdio"] }` (`source: "bundled-path-node"`), requiring a
Node `24.11+` on `PATH`, with a note explaining why.

`extension.ts` registers two restart triggers before the very first
`start()` runs: an `onDidChangeConfiguration` listener for an edit to
`okfit.lsp.serverPath` on any folder (`client.ts` reads the setting per
folder directly from `vscode.workspace.getConfiguration`, not through a
reactive proxy, so this one listener on the raw event is both necessary
and sufficient -- a second, window-level reactive `watch` over the same
setting used to fire a duplicate restart per edit and was removed), and an
`onDidChangeWorkspaceFolders` listener (a folder added to the window may
bring a better candidate). Both funnel through the same `SerialQueue`, so
editing the setting back, or adding a folder with a newer server, is the
recovery path even for a failed first start. Every restart, and the
extension's own final stop, disposes the outgoing client's two
`FileSystemWatcher`s alongside `client.stop()` (`extension.ts`'s
`stopQuietly`) -- `vscode-languageclient` never takes ownership of a raw
`synchronize.fileEvents` watcher itself, only of the listeners it attaches
to one, so the caller that created the watcher is the only one that can
free it.

## Views and commands

- **OKF Concepts** (`okfit.concepts`, Explorer sidebar, `$(book)` icon,
  starts collapsed) -- `ConceptsProvider` (`src/tree/provider.ts`) groups
  every live bundle's concepts by type, with a numeric stale-count badge
  per bundle and status decorations (`ConceptDecorations`,
  `src/tree/decorations.ts`) fed by `okfit/concepts` and refreshed on
  `okfit/bundleChanged`. Built only when the started client's
  `initializeResult.capabilities.experimental.okfitConcepts` is `true`
  (`extension.ts`'s `start`): a resolved `okfit-lsp` published before this
  capability existed -- most likely a workspace's own
  `node_modules/.bin/okfit-lsp`, or an `@okfit/plugin` wrapping it, pinned
  by a lockfile to `@okfit/lsp` `<= 0.2.0` -- would otherwise fail
  `okfit/concepts` with `MethodNotFound`. When the capability is absent the
  extension logs one line naming the resolved source and target, sets
  `okfit.hasBundle` to `false` and `okfit.serverTooOld` to `true` (a second
  `viewsWelcome` entry tells the user to upgrade `@okfit/lsp` or clear
  `okfit.lsp.serverPath`), and skips the tree entirely; diagnostics, hover
  and navigation are unaffected either way, since they come from the
  language client itself.
- **Language Status item** (`okfit.status`) -- one item for the whole
  activation, routed at `NO_BUNDLE_SELECTOR` (a pattern nothing on disk
  matches) when no live bundle owns the active document rather than being
  disposed and rebuilt per document (`vscode/src/extension.ts:17,68-101`);
  its command opens `okfit.validateBundle`. `statusFor`
  (`vscode/src/status.ts:19-30`) computes its text, detail and severity
  from the active document's bundle and the workspace's own diagnostics;
  its caller (`updateStatus`) re-parses each `bundle.rootUri` through
  `vscode.Uri` before comparing it against `document.uri.toString()` and
  each diagnostic's `uri`, since `rootUri` is Node's unencoded
  `pathToFileURL` while those are VS Code's own percent-encoded
  `Uri.toString()` -- `statusFor` itself stays pure and only ever compares
  already-normalized strings. The selector is built from
  `vscode.Uri.file(status.detail)` plus a `RelativePattern`, not a raw
  fsPath interpolated into a glob, so it holds on Windows paths and roots
  containing `[`, `{` or `*`.
- **OKF: Validate Bundle** (`okfit.validateBundle`) -- when the started
  client advertises `okfit.revalidate` (LSP roadmap phase 5), asks the
  server to run a fresh `full` revalidate first over `workspace/
  executeCommand`, then re-requests the concept list and re-publishes the
  tree and status item; an older server that does not advertise it falls
  back to the refresh-only behaviour (`vscode/src/commands.ts`'s
  `useCommand("okfit.validateBundle", ...)`). The client also watches
  every markdown file and the okfit config glob
  (`vscode/src/client.ts`'s `synchronize.fileEvents`) and forwards both as
  `didChangeWatchedFiles`, so the server already revalidates on document
  changes and on markdown/config changes made outside an editor. Pull
  diagnostics are not advertised in this release.
- **OKF: Open Concept…** (`okfit.openConcept`) -- a quick pick over every
  concept in every live bundle, opening the picked concept's document
  (`vscode/src/commands.ts`).
- **OKF: Set Status…** (`okfit.setStatus`) -- resolves the target concept's
  URI from the invoking tree node or the active editor
  (`vscode/src/status-picks.ts`'s `conceptUriFrom`), shows a quick pick over
  the two statuses the concept is not already in
  (`statusPicks`, `Status`'s own literal order), and sends `workspace/
  executeCommand` `okfit.setStatus [uri, status]`; the server computes the
  edit and applies it through `workspace/applyEdit`, and a `{ applied:
  false, failureReason }` or transport failure surfaces as one error
  dialog (`vscode/src/commands.ts`'s `runEditCommand`).
- **OKF: Mark Verified** (`okfit.markVerified`) -- same URI resolution and
  `workspace/applyEdit` round trip, over `okfit.markVerified [uri]`; the
  server resolves the human actor and computes the edit.

All four commands appear in the Command Palette only while a bundle is
live (`okfit.hasBundle`, or `okfit.isConcept && okfit.hasActions` for the
latter two), and as toolbar actions on the OKF Concepts view's title bar
(`view/title`) or inline actions on a concept tree item (`view/item/
context`, both the `inline` group and the `okfit@1` submenu group) for Set
Status and Mark Verified. `okfit.isConcept` and `okfit.hasActions` are
context keys the extension sets from the active document's bundle
membership and the started client's `executeCommandProvider.commands`
list, so both commands disable themselves against a server that predates
`okfit.setStatus`/`okfit.markVerified`, and during a client restart
(`vscode/src/commands.ts`'s `getClient() === undefined` guard logs instead
of showing a dialog).

The root workspace's `vscode:package` and `vscode:install` scripts build
`@okfit/lsp`, build and package this extension (`vsce package
--no-dependencies`), then uninstall and reinstall the resulting `.vsix`
through the `code` CLI (`vscode/lib/install-vsix.ts`) -- the local-install
path a human runs instead of the Marketplace for a same-machine check.

## Distribution

Tag-only, like `plugins/claude-code`: a merged changeset for
`@okfit/vscode-extension` tags a GitHub release, which the `VS Code
Marketplace` workflow packages and publishes to the Visual Studio
Marketplace and Open VSX, checking for a `VSCE_PAT` secret first and
falling back to Microsoft Entra ID workload identity federation only when
none is set. Procedure, secrets table and dry-run instructions: [Publish
the VS Code extension](../runbooks/publish-vscode-extension.md).

## Not in scope

Phase 6 (this extension) was sequenced before phase 5 (Actions) on
2026-09-23; phase 5 landed the same day and Set Status and Mark Verified
joined this extension in the Views and commands section above. A quick
fix beyond `status-missing`, a batch verify command, and a code lens are
still out of scope, as are completion of link targets and type names,
semantic tokens, and a web extension build, tracked in [An @okfit/lsp
language server and a VS Code extension over the shared
engine](../roadmaps/lsp-server-and-vscode-extension.md).

## Links

- [LSP](lsp.md) -- the `okfit-lsp` server this extension's language client
  runs, and the `okfit/concepts`/`okfit/bundleChanged` protocol extensions
  the tree view and status item consume.
- [Workspace](workspace.md) -- the workspace layout `vscode/` joins.
- [The VS Code extension lives at vscode/, not under plugins/ or
  packages/](../decisions/vscode-extension-at-repo-root.md)
- [Publish the VS Code
  extension](../runbooks/publish-vscode-extension.md)
- [An @okfit/lsp language server and a VS Code extension over the shared
  engine](../roadmaps/lsp-server-and-vscode-extension.md)
