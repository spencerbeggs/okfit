# @okfit/lsp

Language Server Protocol server for [okfit](https://github.com/spencerbeggs/okfit). Publishes background diagnostics for an Open Knowledge Format bundle into any LSP client, Claude Code included.

> **Part of the okfit kit.** Most users want **[@okfit/plugin](https://www.npmjs.com/package/@okfit/plugin)**, which pulls this package in automatically and launches this server through the Claude Code plugin's `lspServers.okfit` entry.

## What it is

`@okfit/lsp` speaks the Language Server Protocol over stdio for one or
more discovered OKF bundles. The `.md` binding is the client's own
registration (the Claude Code plugin manifest's `extensionToLanguage`);
this server answers for any document under a discovered bundle root. It
discovers a bundle per workspace folder the same way the CLI and MCP
server do, and
publishes `okfit validate`'s diagnostics as documents open, change, save,
or close. It
writes nothing to the bundle, ever — the same promise the MCP server
makes, carried to a second front end. This first release is
diagnostics-only: no hover, navigation, or code actions yet.

## Launching it

Most users never invoke this directly — the Claude Code plugin's
`bin/start-lsp.sh` loader resolves the project's own
`node_modules/.bin/okfit-lsp` and falls back to `npx --yes @okfit/lsp`
when it is not installed. To run it directly, the package's own bin is
`okfit-lsp --stdio`; `--stdio` is accepted and silently ignored, since
streams are always stdin/stdout. `--node-ipc`, `--socket`, and `--pipe`
are not supported. `--clientProcessId=<pid>` is accepted, and the server
still exits on `exit`. The server's own signal that the client has gone
is its input stream closing; the underlying `vscode-languageserver`
library separately polls that process and exits with code 1 if it
disappears first.

## Publishing behaviour

- `didOpen`/`didSave` trigger a full revalidate; `didChange`/`didClose`
  trigger a cheaper edit-tier revalidate.
- The server registers no file watchers. When a client sends
  `workspace/didChangeWatchedFiles` itself, a change triggers a full
  revalidate on every live session. A config discovery file is the
  exception: it drops that folder's session, and nothing is republished
  until the next document event. Claude Code sends no watched-file
  events, so a config edit during a Claude Code session needs a session
  restart to take effect.
- A folder whose config fails to load is logged once and retried on the
  next `didOpen` or `didSave` under it, so fixing the config and saving
  a document recovers it.
- Exactly one `textDocument/publishDiagnostics` per file whose diagnostic
  set changed: an unchanged file is not republished, an emptied file
  publishes `[]`, and a file not open in the editor still publishes when
  its diagnostics change.
- A bundle-level diagnostic publishes against the bundle root's
  `index.md`.
- A non-`file:` URI, and any document outside every discovered bundle
  root, is ignored.
- Diagnostics for several files can arrive together in one client
  notification batch; in Claude Code that batch reaches the model's
  context on the next `Edit` or `Write` tool call, not immediately.

## Custom methods

Two `okfit/`-prefixed extensions, for editor front ends (the VS Code
extension's concept explorer); neither is part of the LSP standard, and the
LSP specification reserves `$/` for its own extensions, leaving vendor
prefixes to implementations.

- **`okfit/concepts`** (request, params `{}`) answers every live workspace
  folder's last-loaded bundle as `{ bundles: [{ root, rootUri, profile,
  concepts: [{ id, uri, title, type, status, stale }] }] }`: `status` is
  `"draft" | "stable" | "deprecated" | undefined` (absent when the
  frontmatter has none), `stale` is computed against the request time, and a
  session whose bundle has never loaded contributes no bundle entry.
- **`okfit/bundleChanged`** (notification, params `{ rootUri, reason:
  "revalidated" | "dropped" }`) is sent after every revalidate of a bundle
  root's diagnostics and after that root's session is dropped, so a client
  knows when to re-fetch `okfit/concepts`. The server advertises support with
  `experimental: { okfitConcepts: true }` in `initialize`'s result.

## Status

Diagnostics only, shipped in phase 3 of the LSP roadmap. Navigation,
hover, and code actions are later phases; see the project's own
`okf/roadmaps/lsp-server-and-vscode-extension.md` for the full plan.

## License

[MIT](LICENSE)
