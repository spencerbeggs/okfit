---
"@okfit/vscode-extension": minor
---

## Features

First release.

### Language client

* Connects to `@okfit/lsp` over stdio, resolving the server in order: the `okfit.lsp.serverPath` setting, a workspace folder's own `node_modules/.bin/okfit-lsp`, then the server bundled into the extension — no installation required
* Supports multi-root workspaces: one language client per window, config discovered per folder
* Traces client/server communication through `okfit.lsp.trace.server`

### OKF Concepts explorer

* Explorer sidebar tree view grouping every live bundle's concepts by type, with a numeric stale-count badge and status decorations

### Language Status item

* Shows the active document's bundle and profile, or the worst diagnostic severity among that bundle's files, in the editor's status area

### Commands

* `OKF: Validate Bundle` — re-requests the concept list and re-publishes the tree and status item
* `OKF: Open Concept…` — a quick pick over every concept in every live bundle

### Publishing

* Ships to the Visual Studio Marketplace (`okfit.okfit`) and Open VSX via a tag-triggered GitHub Actions workflow, packaged with `vsce package --no-dependencies`
