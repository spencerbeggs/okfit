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

- **OKF: Validate Bundle** (`okfit.validateBundle`) -- re-requests the
  concept list from the language server and re-publishes the tree and
  status item. The extension watches every markdown file and the okfit
  config glob and forwards both as `didChangeWatchedFiles`, so the server
  already revalidates on document changes and on markdown/config changes
  made outside an editor (Explorer, `git checkout`/`pull`, a codegen run);
  this command refreshes the client's view of the last published result
  rather than forcing a new validation pass, and is the manual fallback
  when a watcher event is missed. A server-side revalidate command lands
  in a later release.
- **OKF: Open Concept…** (`okfit.openConcept`) -- a quick pick over every
  concept in every live bundle, opening the picked concept's document.

Both commands appear in the Command Palette only while a bundle is live,
and as toolbar actions on the OKF Concepts view's title bar.

## Requirements

A workspace containing an OKF bundle with a `.okfit.toml`, `okfit.toml`,
or `.config/okfit.toml` config file -- the extension activates on any of
these.

The extension resolves which `okfit-lsp` to run, in this order:

1. `okfit.lsp.serverPath`, if set and the path exists.
2. A workspace folder's own `node_modules/.bin/okfit-lsp`, in window
   order (the first folder that has one wins).
3. The server bundled into this extension -- always available, no
   installation required.

The bundled source (3) normally runs in-process under the extension
host's own Node. On a VS Code release whose extension host runs Node
older than `@okfit/lsp`'s `engines.node` floor (`24.11.0`), the extension
instead launches the bundled server as a `node` subprocess, so a Node
`24.11+` on `PATH` is required in that case when no workspace-local
`okfit-lsp` exists (sources 1 and 2 above are unaffected either way).

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
and Debug view. The output channel named "okfit" logs which server
source (`setting`, `workspace`, or `bundled`) was resolved; "okfit
language server" carries the language client's own trace when
`okfit.lsp.trace.server` is not `"off"`.

To try a packaged build without the debugger:

```bash
pnpm --filter @okfit/vscode-extension build
pnpm --filter @okfit/vscode-extension package
code --install-extension vscode/okfit.vsix --force
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
