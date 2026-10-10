# @okfit/lsp

## 0.4.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/lsp | dependency | updated | ^0.1.0 | ^0.1.1 |
| @effected/schemastore | dependency | updated | ^0.21.3 | ^0.21.4 |
| @okfit/engine | dependency | updated | 0.14.0 | 0.14.1 |

[#273][#273]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#273]: https://github.com/spencerbeggs/okfit/pull/273

## 0.4.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.9.1 | 0.9.2 |
| @okfit/engine | dependency | updated | 0.13.2 | 0.14.0 |
| @okfit/profiles | dependency | updated | 0.9.0 | 0.9.0 |

## 0.4.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | ^0.21.2 | ^0.21.3 |
| @okfit/engine | dependency | updated | 0.13.1 | 0.13.2 |

[#263][#263]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#263]: https://github.com/spencerbeggs/okfit/pull/263

## 0.4.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | ^4.0.1 | ^4.0.2 |
| @effected/schemastore | dependency | updated | ^0.21.1 | ^0.21.2 |
| @okfit/engine | dependency | updated | 0.13.0 | 0.13.1 |
| effect | dependency | updated | ^4.0.1 | ^4.0.2 |
| vscode-languageserver | dependency | updated | ^10.1.1 | ^10.1.2 |

[#261][#261]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#261]: https://github.com/spencerbeggs/okfit/pull/261

## 0.4.0

### Features

- Add a "Mark verified by <actor> and set status: stable" code action on draft concepts. It records your verification and promotes the concept to stable in a single edit.
- Add the `okfit.lsp.verifyAndMarkStable` command, which takes the concept `uri` as its one argument. The new command id is included in `OKFIT_COMMANDS`.
- Add a `NotADraft` tag to `EditFailure`, returned when the combined action targets a concept whose status is not draft. [#250][#250]

### Bug Fixes

- Report a launch failure on stderr. Launched without `HOME`, `okfit-lsp` wrote its `XdgEnvError` report to stdout, the JSON-RPC wire, where a client read it as a corrupt frame; it now exits `1` with the report on stderr and stdout empty, through `LspStdio.launch`.
- Install the crash guards through `ProcessGuard.run` from `@effected/engine/guard` with an `exitBeforeConnect` policy, as `okfit-mcp` does: a stray exception before the server is serving exits `1`, and one after it is logged to stderr while the server keeps answering. Reports now read `okfit-lsp: uncaughtException (<origin>): ...` and `okfit-lsp: unhandledRejection: ...`.
- Launch through `LspStdio.launch` and `LspStdio.teardown` from `@effected/lsp` (new runtime dependency) instead of hand-written `runMain` options: the exit code mapping and the explicit exit on `exit` are the kit's, and behaviour is unchanged.

### Tests

- The suite pins both halves of the crash policy and the stderr-only launch failure against the built bin, driven through `LspProcess` from `@effected/lsp/testing`. [#251][#251]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | ^4.0.0 | ^4.0.1 |
| @effected/config-file | dependency | updated | ^0.14.0 | ^0.14.2 |
| @effected/jsonc | dependency | updated | ^0.15.0 | ^0.15.1 |
| @effected/markdown | dependency | updated | ^0.15.0 | ^0.15.1 |
| @effected/schemastore | dependency | updated | ^0.20.0 | ^0.21.1 |
| @effected/toml | dependency | updated | ^0.11.0 | ^0.11.1 |
| @effected/yaml | dependency | updated | ^0.19.0 | ^0.19.1 |
| @okfit/core | dependency | updated | 0.9.0 | 0.9.1 |
| @okfit/engine | dependency | updated | 0.12.0 | 0.13.0 |
| @okfit/profiles | dependency | updated | 0.9.0 | 0.9.0 |
| effect | dependency | updated | ^4.0.0 | ^4.0.1 |
| @effected/engine | dependency | added | — | ^0.4.0 |
| @effected/lsp | dependency | added | — | ^0.1.0 |

[#251][#251]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#250]: https://github.com/spencerbeggs/okfit/pull/250

[#251]: https://github.com/spencerbeggs/okfit/pull/251

## 0.3.8

### Features

- The language server now reports the docs-surface diagnostics `publication-drift`, `publication-orphan`, and `surface-unmatched`, picked up from `@okfit/engine`'s validate. [#247][#247]

### Bug Fixes

- `okfit-lsp` no longer crashes with `process.stdin.unref is not a function` when started with stdin from a file or `/dev/null` instead of a pipe. [#247][#247]

* The language server no longer offers the "Mark verified" code action on a deprecated concept, and `okfit.lsp.markVerified` now refuses one, matching `okfit verify --batch`. [#247][#247]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.8.5 | 0.9.0 |
| @okfit/engine | dependency | updated | 0.11.1 | 0.12.0 |
| @okfit/profiles | dependency | updated | 0.8.3 | 0.9.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#247]: https://github.com/spencerbeggs/okfit/pull/247

## 0.3.7

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | ^0.18.0 | ^0.20.0 |
| @okfit/core | dependency | updated | 0.8.4 | 0.8.5 |
| @okfit/engine | dependency | updated | 0.11.0 | 0.11.1 |
| @okfit/profiles | dependency | updated | 0.8.3 | 0.8.3 |

[#235][#235]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#235]: https://github.com/spencerbeggs/okfit/pull/235

## 0.3.6

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.118 | ^4.0.0 |
| @effected/config-file | dependency | updated | ^0.13.1 | ^0.14.0 |
| @effected/git | dependency | updated | ^0.19.0 | ^0.20.0 |
| @effected/glob | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/jsonc | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/markdown | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/schemastore | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/toml | dependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/walker | dependency | updated | ^0.14.1 | ^0.15.0 |
| @effected/xdg | dependency | updated | ^0.8.2 | ^0.9.0 |
| @effected/yaml | dependency | updated | ^0.18.0 | ^0.19.0 |
| @okfit/core | dependency | updated | 0.8.3 | 0.8.4 |
| @okfit/engine | dependency | updated | 0.10.0 | 0.11.0 |
| @okfit/profiles | dependency | updated | 0.8.2 | 0.8.3 |
| effect | dependency | updated | 4.0.0-rc.118 | ^4.0.0 |

[#225][#225]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#225]: https://github.com/spencerbeggs/okfit/pull/225

## 0.3.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/engine | dependency | updated | 0.9.4 | 0.10.0 |

## 0.3.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/xdg | dependency | updated | ^0.8.1 | ^0.8.2 |
| @okfit/engine | dependency | updated | 0.9.3 | 0.9.4 |

[#209][#209]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#209]: https://github.com/spencerbeggs/okfit/pull/209

## 0.3.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | ^0.13.0 | ^0.13.1 |
| @effected/git | dependency | updated | ^0.18.1 | ^0.19.0 |
| @effected/walker | dependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/xdg | dependency | updated | ^0.8.0 | ^0.8.1 |
| @okfit/core | dependency | updated | 0.8.2 | 0.8.3 |
| @okfit/engine | dependency | updated | 0.9.2 | 0.9.3 |
| @okfit/profiles | dependency | updated | 0.8.1 | 0.8.2 |

[#203][#203]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#203]: https://github.com/spencerbeggs/okfit/pull/203

## 0.3.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | ^0.16.0 | ^0.17.0 |
| @okfit/core | dependency | updated | 0.8.1 | 0.8.2 |
| @okfit/engine | dependency | updated | 0.9.1 | 0.9.2 |
| @okfit/profiles | dependency | updated | 0.8.1 | 0.8.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.3.1

### Bug Fixes

- Declared the `@effected/*` peers that `@okfit/core` and `@okfit/profiles` require, so installs no longer satisfy them from whatever version sits at the consumer root [#196][#196]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.117 | 4.0.0-rc.118 |
| @effected/git | dependency | updated | ^0.17.0 | ^0.18.1 |
| @effected/markdown | dependency | updated | ^0.12.1 | ^0.14.0 |
| @effected/xdg | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/yaml | dependency | updated | ^0.17.0 | ^0.18.0 |
| @okfit/core | dependency | updated | 0.8.0 | 0.8.1 |
| @okfit/engine | dependency | updated | 0.9.0 | 0.9.1 |
| @okfit/profiles | dependency | updated | 0.8.0 | 0.8.1 |
| effect | dependency | updated | 4.0.0-rc.117 | 4.0.0-rc.118 |
| @effected/config-file | dependency | added | — | ^0.13.0 |
| @effected/glob | dependency | added | — | ^0.9.0 |
| @effected/jsonc | dependency | added | — | ^0.14.0 |
| @effected/schemastore | dependency | added | — | ^0.16.0 |
| @effected/toml | dependency | added | — | ^0.10.0 |
| @effected/walker | dependency | added | — | ^0.13.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#196]: https://github.com/spencerbeggs/okfit/pull/196

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
