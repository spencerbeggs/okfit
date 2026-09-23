# @okfit/lsp

## 0.2.0

### Features

#### Document links, definition, references, hover and workspace symbols

- The language server now answers five more LSP requests over a workspace folder's last-loaded bundle:

- `textDocument/documentLink`, `textDocument/definition` and `textDocument/references` — navigate between a concept's body links and frontmatter path fields and the concepts they point at.

- `textDocument/hover` — a link or frontmatter path field under the cursor renders its target concept's title, type, status, trust tier and staleness; a `type:` value renders that type's description and guidance; a top-level frontmatter key renders its field description, all sourced from the bundle's config vocabulary.

- `workspace/symbol` — a case-insensitive substring match over every live session's concepts by id and title (an empty query matches everything), capped at 200 results.

#### Config changes reload a bundle root instead of requiring a restart

- The session registry now keys sessions by resolved bundle root rather than by workspace folder: two folders that resolve to the same bundle root share one session, reference-counted across the folders attached to it. Editing a config file now reloads that root's session in place, once, however many folders share it — rebuilding it, retrying a config that previously failed to load, and clearing whatever was published for the old session before the new one starts publishing. Previously a config change needed a server restart to take effect.

#### Diagnostics are cleared when a session is dropped

- Removing a workspace folder, or otherwise dropping its bundle root's session, now clears any diagnostics the server had published for it, instead of leaving stale diagnostics behind in the editor — but only once the last folder attached to that root goes; removing one of two folders that share a root leaves the other's session and diagnostics untouched.

#### Debounce now has a maximum wait

- The revalidate debounce that coalesces bursts of edits behind a fixed delay now also has a `maxWait` ceiling: a steady stream of edits that never lets the debounce quiet down still triggers a revalidate once `maxWait` has elapsed since the burst started, instead of being deferred indefinitely. [#179][#179]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.7.4 | 0.8.0 |
| @okfit/engine | dependency | updated | 0.7.5 | 0.8.0 |
| @okfit/profiles | dependency | updated | 0.7.5 | 0.8.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#179]: https://github.com/spencerbeggs/okfit/pull/179

## 0.1.0

### Features

#### Initial release

- `@okfit/lsp` is a Language Server Protocol server for okfit: it speaks
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

- Most users install `@okfit/plugin` instead, which pulls this package in
  automatically and launches it through the Claude Code plugin's
  `lspServers.okfit` entry. [#176][#176]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#176]: https://github.com/spencerbeggs/okfit/pull/176
