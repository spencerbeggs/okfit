# @okfit/mcp

## 0.3.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/git | dependency | updated | ^0.15.0 | ^0.15.1 |
| @effected/xdg | dependency | updated | ^0.5.0 | ^0.5.1 |
| @okfit/core | dependency | updated | 0.3.1 | 0.4.0 |
| @okfit/engine | dependency | updated | 0.2.1 | 0.3.0 |
| @okfit/profiles | dependency | updated | 0.3.1 | 0.4.0 |

[#64][#64]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#64]: https://github.com/spencerbeggs/okfit/pull/64

## 0.3.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effected/git | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/xdg | dependency | updated | ^0.4.1 | ^0.5.0 |
| @okfit/core | dependency | updated | 0.3.0 | 0.3.1 |
| @okfit/engine | dependency | updated | 0.2.0 | 0.2.1 |
| @okfit/profiles | dependency | updated | 0.3.0 | 0.3.1 |
| effect | dependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

[#55][#55]

### Other

- Served tool input schemas now declare `additionalProperties: true` on every object with declared properties instead of `false`. Effect's JSON Schema generator leaves unmodeled properties open by default since rc.113, matching the decoder, and `Tool` compiles input schemas without options; unknown keys in a tool call were already ignored at runtime, so only the advertised schema changes. [#55][#55]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#55]: https://github.com/spencerbeggs/okfit/pull/55

## 0.3.1

### Bug Fixes

- `validate_bundle` now declares `Crypto.Crypto` among its dependencies,
  matching the `Crypto.Crypto` requirement `@okfit/profiles`' two-tier
  `generated-at-drift` lint (issue #19) now carries. The tool's parameters
  and output shape are unchanged; this only wires the dependency the
  underlying lint already needed to run correctly. [#49][#49]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.2.0 | 0.3.0 |
| @okfit/engine | dependency | updated | 0.1.0 | 0.2.0 |
| @okfit/profiles | dependency | updated | 0.2.0 | 0.3.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#49]: https://github.com/spencerbeggs/okfit/pull/49

## 0.3.0

### Features

- `@okfit/mcp` no longer depends on `@okfit/cli`. It now depends on `@okfit/engine` directly for the platform layer, config discovery, and the validate/verify/sync/init/context programs it needs.

- `pnpm add -D @okfit/mcp` no longer resolves `@effected/cli` or the CLI's command tree

- `@okfit/mcp` continues to resolve the same user-level config directory as `@okfit/cli`, since both now provide the same `@okfit/engine` `OkfitPlatform` layer

- `@okfit/mcp`'s `./main` export condition (`src/main.ts`, the assembled program) is now supported public surface — it is what `@okfit/plugin`'s bin shims import [#28][#28]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/engine | dependency | updated | 0.0.0 | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#28]: https://github.com/spencerbeggs/okfit/pull/28

## 0.2.0

### Features

- First usable release of `@okfit/mcp`: a Model Context Protocol server, `okfit-mcp`, exposing an OKF bundle to agents over stdio. The server is read-only — no tool or resource ever writes to the bundle, the config, or anywhere else.

- The server resolves its project root as `OKFIT_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → the process's current working directory, with no command-line flags.

#### Six tools

| Tool | Returns |
| --- | --- |
| `describe_vocabulary` | Resolved project/bundle roots, active profile, agent actor, and the config's declared type and tag vocabulary. |
| `list_concepts` | Concept summaries, filterable by type, tags, and status; paginated with `limit`/`offset`. |
| `get_concept` | One concept's full decoded frontmatter, raw markdown text, bundle-relative path, and outgoing links. |
| `concept_neighbors` | A concept's graph neighbours — everything it links to and everything that links to it. |
| `stale_report` | Every concept past its `stale_after` instant, as of now or an explicit instant. |
| `validate_bundle` | The same conformance and lint report `okfit validate --format json` produces. |

#### Two resources

- `okf://index` re-reads the bundle's root `index.md` from disk on every call. `okf://concept/<id>` registers one static resource per concept, loaded when the server starts; edits to an already-listed concept are picked up live, but a concept added or removed after boot needs a server restart to appear.

- A failing tool call reaches the client as `isError: true`, with the remediation hint folded into the message text, across five typed error cases: `ConfigError`, `BundleNotFound`, `ConceptNotFound`, `UnknownVocabulary`, and `InvalidArgument`. [#16][#16]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/cli | dependency | updated | 0.1.0 | 0.2.0 |
| @okfit/core | dependency | updated | 0.1.0 | 0.2.0 |
| @okfit/profiles | dependency | updated | 0.1.0 | 0.2.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#16]: https://github.com/spencerbeggs/okfit/pull/16

## 0.1.0

### Features

- Bootstrap the okfit monorepo with package skeletons for core, profiles, cli, mcp, plugin, and the Claude Code plugin.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.0.0 | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!
