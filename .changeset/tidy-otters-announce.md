---
"@okfit/lsp": minor
---

## Features

### Initial release

`@okfit/lsp` is a Language Server Protocol server for okfit: it speaks
LSP over stdio and publishes an Open Knowledge Format bundle's `okfit
validate` diagnostics into any LSP client, Claude Code included. It
discovers a bundle per workspace folder the same way the CLI and MCP
server do, and writes nothing to the bundle, ever.

- `okfit-lsp` bin, run directly as `okfit-lsp --stdio` (`--stdio` is
  accepted and silently ignored — streams are always stdin/stdout;
  `--node-ipc`, `--socket`, and `--pipe` are not supported)
- `didOpen`/`didSave` trigger a full revalidate; `didChange`/`didClose`
  trigger a cheaper edit-tier revalidate; a watched-file change triggers a
  full revalidate on every live session
- Exactly one `textDocument/publishDiagnostics` per file whose diagnostic
  set changed; a bundle-level diagnostic publishes against the bundle
  root's `index.md`
- This first release is diagnostics-only: no hover, navigation, or code
  actions yet

Most users install `@okfit/plugin` instead, which pulls this package in
automatically and launches it through the Claude Code plugin's
`lspServers.okfit` entry.
