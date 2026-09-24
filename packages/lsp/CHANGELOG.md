# @okfit/lsp

## 0.3.0

### Features

- `okfit/concepts` request — answers with every discovered bundle's concepts for an editor's concept explorer: `{ id, uri, title, type, status, stale }` per concept, grouped under `{ root, rootUri, profile, concepts }` per bundle, from each live session's last-loaded snapshot; the request warms up every workspace folder that has never been resolved on demand, so a client asking before any document is open still gets a populated result -- warm-up now runs at most once per bundle root per session: a root whose bundle still fails to load after its first warm-up is not re-scheduled by a later request, only by a rebuild (a config-change rebuild, or its last workspace folder going away and a new one arriving), which gives it a fresh attempt
- `okfit/bundleChanged` notification — sent after a bundle root's diagnostics are republished (`reason: "revalidated"`) and after its session is dropped (`reason: "dropped"`), so a client knows when to re-fetch `okfit/concepts`
- `initialize`'s result now advertises `experimental: { okfitConcepts: true }` so a client can feature-detect both extensions
- `textDocument/codeAction` — `Set status: <status>` actions (one per status the concept's frontmatter does not already name, all three when it names none) and a `Mark verified by <actor>` action when a human actor resolves, offered when the request range touches the frontmatter or `context.only` asks for them; a `status-missing` diagnostic adds `Set status: draft` (preferred) and `Set status: stable` quick fixes
- Every edit a code action or command produces is computed against the document's current editor text; a command's edit is also sent as a versioned `documentChanges` entry, so the editor refuses it once the buffer has moved on -- a code action's edit carries no version (the client drops it), and stays safe only because it is recomputed from the current buffer on each request
- `workspace/executeCommand` — `okfit.lsp.setStatus [uri, status]`, `okfit.lsp.markVerified [uri]` (edits sent to the client through `workspace/applyEdit`, never written to disk), and `okfit.lsp.revalidate [rootUri?]` for an on-demand `full` revalidate
- `textDocument/inlayHint` — a trust/staleness hint after `status:` (or `type:` when `status` is absent) and a `generated.at` age hint, both from the last-loaded snapshot
- `initialize`'s result now also advertises `codeActionProvider`, `executeCommandProvider` and `inlayHintProvider`, naming the command ids and code action kinds in `features/names.ts`'s `OKFIT_COMMANDS`/`OKFIT_CODE_ACTION_KINDS` [#181][#181]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/engine | dependency | updated | 0.8.0 | 0.9.0 |
| @effected/markdown | dependency | added | — | ^0.12.1 |
| @effected/yaml | dependency | added | — | ^0.17.0 |

[#181][#181]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#181]: https://github.com/spencerbeggs/okfit/pull/181

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
