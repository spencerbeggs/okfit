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

* `OKF: Validate Bundle` — asks the server for a fresh revalidate when it advertises `okfit.revalidate`, then re-requests the concept list and re-publishes the tree and status item
* `OKF: Open Concept…` — a quick pick over every concept in every live bundle
* `OKF: Set Status…` — quick pick over the two statuses a concept is not already in, applied through `workspace/executeCommand`
* `OKF: Mark Verified` — marks a concept verified by the configured human actor, applied the same way
* Set Status and Mark Verified appear as inline and context-menu actions on a concept in the OKF Concepts tree, and disable themselves against a server that predates them

### Local install

* Root `vscode:package` and `vscode:install` scripts build `@okfit/lsp` and this extension, package a `.vsix`, and reinstall it through the `code` CLI

### Publishing

* Ships to the Visual Studio Marketplace (`okfit.okfit`) and Open VSX via a tag-triggered GitHub Actions workflow, packaged with `vsce package --no-dependencies`
