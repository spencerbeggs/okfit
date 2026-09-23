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
  at: 2026-09-23T18:54:37Z
  body_sha256: 9a1e2e7044acb5bb5925aefea123fe9263e2b840d51fcb16f849986aedf574db
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

- `src/extension.ts` (`vscode/src/extension.ts:1-219`) -- the extension
  host entry, built with `reactive-vscode`'s `defineExtension`: builds the
  file-decoration provider and Language Status item once per activation,
  starts the language client, feature-detects `experimental.okfitConcepts`
  on the started client before building the `ConceptsProvider` tree and its
  `TreeView` (Views and commands below), wires `updateStatus` to the
  active-editor and diagnostics events (normalizing `bundle.rootUri`
  through `vscode.Uri` before comparing it against `document.uri`), and
  serializes every client restart -- including the first `start()`, whose
  `okfit.lsp.serverPath` `watch` is registered before it runs -- and the
  final stop on deactivation, through one `SerialQueue`
  (`vscode/src/serial-queue.ts`) so overlapping `stop()`/`start()` calls
  can never leak a client.
- `src/client.ts` (`vscode/src/client.ts:37-91`) -- `startClient`: resolves
  the server with `resolveServer` (below), builds the `LanguageClient` with
  a `markdown` and config-glob `documentSelector`, watches both the config
  glob and every markdown file so a concept file changed outside an editor
  still reaches the server as `didChangeWatchedFiles`, and on a start
  failure logs which of the three resolution sources it tried and shows one
  error dialog with an "Open Output" action -- not retried within that
  attempt, but `extension.ts` registers the `okfit.lsp.serverPath` `watch`
  before the very first `start()`, so the next setting change is the
  recovery path even for a failed first start. Returns both the started
  `LanguageClient` and the resolved `ServerLaunch`, so the caller can
  feature-detect `experimental.okfitConcepts` and log which source and
  target were actually used.
- `src/config-glob.ts` (`vscode/src/config-glob.ts:1-7`) -- `CONFIG_GLOB`:
  the okfit config-file glob shared by `client.ts`'s file-system watcher
  and the extension manifest's `activationEvents`, pinned together by
  `__test__/manifest.test.ts` so the two can never drift apart silently.
- `src/resolve-server.ts` (`vscode/src/resolve-server.ts:56-86`) --
  `resolveServer`: the pure, three-step server resolution plus the bundled
  launch's own host-Node check (Server resolution below).
- `src/config.ts` -- the `reactive-vscode` `defineConfiguration` proxy over
  the `okfit.*` settings.
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

`resolveServer` (`vscode/src/resolve-server.ts:56-86`) picks the
`okfit-lsp` to run, first hit wins:

1. `okfit.lsp.serverPath`, a resource-scoped setting, if set and the path
   exists (`source: "setting"`).
2. `<folder>/node_modules/.bin/okfit-lsp`, tried per workspace folder in
   window order (`source: "workspace"`).
3. The server bundled into the extension itself, `dist/server.js`, built
   from `server/main.ts` -- always available, no installation required.

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
Node `24.11+` on `PATH`, with a note explaining why. A `client.start()`
failure is not retried automatically within that attempt, but the
`okfit.lsp.serverPath` `watch` (`extension.ts`) is registered before the
very first `start()` runs, so editing the setting is the recovery path even
for a failed first start; see Layout above.

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
- **OKF: Validate Bundle** (`okfit.validateBundle`) -- re-requests the
  concept list from the language server and re-publishes the tree and
  status item; the client watches every markdown file and the okfit config
  glob (`vscode/src/client.ts`'s `synchronize.fileEvents`) and forwards
  both as `didChangeWatchedFiles`, so the server already revalidates on
  document changes and on markdown/config changes made outside an editor,
  and this command refreshes the client's view of the last published
  result rather than forcing a server-side revalidate
  (`vscode/src/commands.ts:7-9`). Pull diagnostics are not advertised in
  this release.
- **OKF: Open Concept…** (`okfit.openConcept`) -- a quick pick over every
  concept in every live bundle, opening the picked concept's document
  (`vscode/src/commands.ts:10-22`).

Both commands appear in the Command Palette only while a bundle is live,
and as toolbar actions on the OKF Concepts view's title bar.

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
2026-09-23, so this release ships without the Set Status and Mark Verified
commands and without inlay hints -- those land once phase 5's engine-side
code actions exist for the client to call. Completion of link targets and
type names, semantic tokens, and a web extension build are deferred
further still, tracked in [An @okfit/lsp language server and a VS Code
extension over the shared
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
