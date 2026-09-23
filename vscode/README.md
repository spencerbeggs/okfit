# okfit

Diagnostics, navigation and a concept explorer for [Open Knowledge
Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
(OKF) bundles, powered by the
[`@okfit/lsp`](https://www.npmjs.com/package/@okfit/lsp) language server.

> **Preview.** This extension is early: it starts the okfit language
> server and surfaces diagnostics, hover, navigation, workspace symbols,
> a concept explorer and a Language Status item.

## Features

- **Diagnostics.** Every OKF lint the `@okfit/engine` reports, published
  with a precise range and re-published as you edit or save.
- **Hover.** A link, a `type:` value, or a frontmatter key renders the
  target concept's title, type, status and staleness, or that field's own
  description.
- **Go to definition** and **find references** for links between
  concepts.
- **Workspace symbols.** Every concept across every open bundle, searched
  by id or title.
- **OKF Concepts explorer.** A tree view (Explorer sidebar) grouping
  every live bundle's concepts by type, with a stale-count badge and
  status decorations.
- **Language Status item.** Shows the active document's bundle and
  profile, or the worst diagnostic severity among that bundle's own
  files, in the editor's status area.

## Commands

- **OKF: Validate Bundle** (`okfit.validateBundle`) -- asks the language
  server to run a fresh full revalidate (`okfit.revalidate`), then
  re-requests the concept list and re-publishes the tree and status item.
  The extension watches every markdown file and the okfit config glob and
  forwards both as `didChangeWatchedFiles`, so the server already
  revalidates on document changes and on markdown/config changes made
  outside an editor (Explorer, `git checkout`/`pull`, a codegen run); this
  command is the manual fallback when a watcher event is missed. Against
  an older language server that does not advertise `okfit.revalidate`,
  it falls back to refreshing the tree from the last published result.
- **OKF: Open Concept…** (`okfit.openConcept`) -- a quick pick over every
  concept in every live bundle, opening the picked concept's document.
- **OKF: Set Status…** (`okfit.setStatus`) -- a quick pick over the two
  statuses a concept does not already have, then asks the language server
  to apply the frontmatter edit. Available from the Command Palette while
  the active editor is on a concept, and from the OKF Concepts view's
  item context menu.
- **OKF: Mark Verified** (`okfit.markVerified`) -- asks the language
  server to add a `verified` entry for the resolved human actor. Same
  availability as Set Status.

`okfit.validateBundle` and `okfit.openConcept` appear in the Command
Palette only while a bundle is live, and as toolbar actions on the OKF
Concepts view's title bar. `okfit.setStatus` and `okfit.markVerified`
appear only while the language server advertises them (an older
`@okfit/lsp` may not).

## Requirements

A workspace containing an OKF bundle with a `.okfit.toml`, `okfit.toml`,
or `.config/okfit.toml` config file -- the extension activates on any of
these.

In a multi-root workspace, one language client serves every folder, so
the extension builds a priority-ordered candidate list rather than
picking a single answer up front:

1. Every folder's `okfit.lsp.serverPath`, if set and the path exists, in
   window order (a resource-scoped setting, read per folder).
2. Every folder's own `node_modules/.bin/okfit-lsp` that exists, in
   window order (deduped when two folders resolve to the same server on
   disk).
3. The server bundled into this extension -- always available, no
   installation required.

The extension starts the first candidate and, if a candidate from
source 2 starts but does not support the concept explorer (an older
`okfit-lsp` from a folder other than the one you're working in), falls
through to the next candidate rather than settling for it; a candidate
from source 1 is your explicit choice and is kept even without that
support. The bundled source (3) normally runs in-process under the
extension host's own Node. On a VS Code release whose extension host
runs Node older than `@okfit/lsp`'s `engines.node` floor (`24.11.0`),
the extension instead launches the bundled server as a `node`
subprocess, so a Node `24.11+` on `PATH` is required in that case when
no earlier candidate exists (sources 1 and 2 above are unaffected
either way).

## Settings

- **`okfit.lsp.serverPath`** (`string`, resource scope, default `""`) --
  absolute path of an `okfit-lsp` executable to run instead of the
  workspace's or the bundled server. Leave empty to auto-detect.
- **`okfit.lsp.trace.server`** (`"off" | "messages" | "verbose"`, window
  scope, default `"off"`) -- traces the communication between VS Code and
  the okfit language server, in the "okfit language server" output
  channel.

## Development

```bash
pnpm --filter @okfit/vscode-extension build
```

Then launch the "Run okfit extension" configuration from VS Code's Run
and Debug view. It passes `--disable-extension=okfit.okfit`, so the
Extension Development Host window disables an installed Marketplace copy
of this extension rather than registering the same views and commands
twice. The output channel named "okfit" logs which server source
(`setting`, `workspace`, or `bundled`) was resolved; "okfit language
server" carries the language client's own trace when
`okfit.lsp.trace.server` is not `"off"`.

To try a packaged build without the debugger, from the repo root:

```bash
pnpm vscode:package   # builds @okfit/lsp and this extension, then packages okfit.vsix
pnpm vscode:install    # vscode:package, then uninstall/reinstall okfit.okfit via the code CLI
```

## Publishing

Releases are cut by changesets like every other workspace member: a merged
changeset for `@okfit/vscode-extension` produces the tag
`@okfit/vscode-extension@X.Y.Z` and a GitHub release. The
`VS Code Marketplace` workflow runs on that release: it packages the
extension, attaches `okfit.vsix` to the release, then publishes to the
Visual Studio Marketplace and Open VSX. Run it by hand with
`workflow_dispatch` and `dry_run: true` to produce the `.vsix` without
publishing.

Repository configuration it needs:

| Name | Kind | Purpose |
| :-- | :-- | :-- |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | variables | Microsoft Entra ID workload identity federation for `vsce publish --azure-credential` (the recommended path; Azure DevOps global PATs retire on 2026-12-01) |
| `VSCE_PAT` | secret | Fallback: a Marketplace **Manage** PAT. When set, the workflow uses it instead of federation. |
| `OVSX_PAT` | secret | Open VSX access token for the `okfit` namespace |

The Marketplace publisher `okfit` and the Open VSX namespace `okfit` must
exist before the first publish.
