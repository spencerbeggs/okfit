# @okfit/engine

## 0.8.0

### Features

#### `source-resource-missing` now ranges at the offending value

- `lintResources`'s `source-resource-missing` diagnostic now ranges at the specific `resource` value that couldn't be resolved — the top-level `resource` field or the relevant `sources[i].resource` entry — instead of carrying no range, using `@okfit/core`'s new `DiagnosticRange.forFrontmatterPath`.

#### New `conceptFor` export

```ts
import { conceptFor } from "@okfit/engine";

const concept = conceptFor(bundle, absolutePath);
```

- Looks up the loaded concept at an absolute path already known to sit under `bundle.root`, returning `Option.none()` for a path outside the bundle, a reserved file, a non-markdown file, or one that never decoded into a concept. This is the same lookup `withFallbackRange` already used internally; it's now available to consumers that need to resolve an editor-reported path (a file URI, a hover position) back to its concept, such as `@okfit/lsp`. [#179][#179]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.7.4 | 0.8.0 |
| @okfit/profiles | dependency | updated | 0.7.5 | 0.8.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#179]: https://github.com/spencerbeggs/okfit/pull/179

## 0.7.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |
| @effected/app | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/config-file | dependency | updated | ^0.11.1 | ^0.12.0 |
| @effected/git | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/glob | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/jsonc | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/markdown | dependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/store | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/toml | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/walker | dependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/xdg | dependency | updated | ^0.6.1 | ^0.7.0 |
| @effected/yaml | dependency | updated | ^0.16.0 | ^0.17.0 |
| @okfit/core | dependency | updated | 0.7.3 | 0.7.4 |
| @okfit/profiles | dependency | updated | 0.7.4 | 0.7.5 |
| effect | dependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |

[#173][#173]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#173]: https://github.com/spencerbeggs/okfit/pull/173

## 0.7.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | ^0.11.0 | ^0.11.1 |
| @effected/walker | dependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/xdg | dependency | updated | ^0.6.0 | ^0.6.1 |
| @okfit/core | dependency | updated | 0.7.2 | 0.7.3 |
| @okfit/profiles | dependency | updated | 0.7.4 | 0.7.4 |

[#169][#169]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#169]: https://github.com/spencerbeggs/okfit/pull/169

## 0.7.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effected/app | dependency | updated | ^0.16.3 | ^0.17.0 |
| @effected/config-file | dependency | updated | ^0.10.1 | ^0.11.0 |
| @effected/git | dependency | updated | ^0.15.2 | ^0.16.0 |
| @effected/glob | dependency | updated | ^0.6.1 | ^0.7.0 |
| @effected/jsonc | dependency | updated | ^0.11.1 | ^0.12.0 |
| @effected/markdown | dependency | updated | ^0.10.1 | ^0.11.0 |
| @effected/store | dependency | updated | ^0.8.1 | ^0.9.0 |
| @effected/toml | dependency | updated | ^0.7.1 | ^0.8.0 |
| @effected/walker | dependency | updated | ^0.9.1 | ^0.10.0 |
| @effected/xdg | dependency | updated | ^0.5.3 | ^0.6.0 |
| @effected/yaml | dependency | updated | ^0.15.2 | ^0.16.0 |
| @okfit/core | dependency | updated | 0.7.1 | 0.7.2 |
| @okfit/profiles | dependency | updated | 0.7.3 | 0.7.4 |
| effect | dependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |

[#162][#162]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#162]: https://github.com/spencerbeggs/okfit/pull/162

## 0.7.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.16.2 | ^0.16.3 |
| @effected/config-file | dependency | updated | ^0.10.0 | ^0.10.1 |
| @effected/git | dependency | updated | ^0.15.1 | ^0.15.2 |
| @effected/glob | dependency | updated | ^0.6.0 | ^0.6.1 |
| @effected/jsonc | dependency | updated | ^0.11.0 | ^0.11.1 |
| @effected/markdown | dependency | updated | ^0.10.0 | ^0.10.1 |
| @effected/store | dependency | updated | ^0.8.0 | ^0.8.1 |
| @effected/toml | dependency | updated | ^0.7.0 | ^0.7.1 |
| @effected/walker | dependency | updated | ^0.9.0 | ^0.9.1 |
| @effected/xdg | dependency | updated | ^0.5.2 | ^0.5.3 |
| @effected/yaml | dependency | updated | ^0.15.1 | ^0.15.2 |

[#156][#156]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#156]: https://github.com/spencerbeggs/okfit/pull/156

## 0.7.1

### Bug Fixes

- fixes pnpm v12 clsure issues

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.7.0 | 0.7.1 |
| @okfit/profiles | dependency | updated | 0.7.2 | 0.7.3 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.7.0

### Breaking Changes

- `okfitConfigSchemaHost` and `SCHEMA_DIRECTIVE` are no longer exported; import them from `@okfit/core`, which now owns the config JSON Schema contract. The `schema:build` / `schema:check` scripts moved there too, and `@effected/schemastore` is no longer a dependency of this package. [#139][#139]

### Features

#### Version metadata on every JSON envelope

- Exports `ENGINE_VERSION`, now stamped as `engine_version` on every JSON envelope (`JsonEnvelope`, `JsonErrorEnvelope`, and the graph/stale/sync/verify envelopes) — the value to compare across reports produced by different front ends.
- Exports `Distribution` and `DistributionField`: every envelope also carries `distribution`, `{ name, version }` for the meta-package a bin was installed through (e.g. `@okfit/plugin`), or `null` for a direct install.
- `ContextEnvelope` gains `config_schema_version`, sourced from `@okfit/core`'s `CONFIG_SCHEMA_VERSION`.

#### `sync` creates a missing `generated:` block

- When `actors.agent` is configured, `runSync` now creates a `generated:` block for a concept that has none, attributed to that agent, instead of only reporting it skipped (issue #73). Digest drift is still decided first, before any provenance lookup, so an already-stamped, unchanged concept costs no git call.

#### `sync` walks git only for concepts that need it

- `runSync` no longer derives `Derivation.generatedAt` for every concept up front. It now walks history only for a concept whose recorded digest doesn't match its current body, or that log mode still needs (issue #21). On this repo's own bundle, `okfit sync --dry-run` drops from roughly 1.68s to 0.27s.

- One user-visible reclassification falls out of the digest-first reorder: a dirty (uncommitted) concept whose body digest still matches its recorded `generated.body_sha256` is now reported `unchanged` rather than `skipped: dirty`, since drift is decided before provenance is even looked at.

#### `sync --since` and `sync --staged`

- `SyncOptions` gains two new options:

- `logSince`: an inclusive `YYYY-MM-DD` floor for log mode; concepts committed on or after it are considered (default: the newest date already logged).

- `staged`: stamps only the concepts currently in the git index with a caller-given instant, instead of walking history, and re-adds what was written. Log mode cannot be combined with `staged` — attempting it fails with the new `SyncStagedLogError`.

- Log mode's window is now inclusive of the newest logged day (issue #18): a concept committed on a day that already has a `## YYYY-MM-DD` group is appended into that group instead of being dropped, deduped against the `Added`/`Updated` lines sync itself wrote so re-running over the same window never duplicates. Hand-written prose is never compared.

#### Batch verification: `runVerifyBatch`

- A new `runVerifyBatch` function attests every unverified concept whose type declares `require_verified`, optionally narrowed to specific types, in one pass — pairing with the CLI's new `verify --all`/`--type`. It returns a `VerifyBatchResult` (via the new `VerifyBatchOptions`/`VerifyBatchSkipReason` types) with per-concept written fragments and skip reasons (`"draft"` or `"already-verified"`). `VerifyBatchEnvelope`/`verifyBatchEnvelope` render it for `--format json`.

- The new `VerifySelectionError` is raised for a contradictory or empty verify selection (missing id/`--all`/`--type`, both given, or an unknown `--type`); like other usage errors it exits `64`.

- `SyncStagedLogError` and `VerifySelectionError` both carry `[Runtime.errorExitCode] = 64`, so `render/json.ts`'s `jsonError`/`JsonErrorEnvelope` now surface `exit_code: 64` for them under `--format json` — `JsonErrorEnvelope.exit_code` is `3 | 64`, no longer the literal `3`. [#141][#141]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.6.0 | 0.7.0 |
| @okfit/profiles | dependency | updated | 0.7.1 | 0.7.2 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#139]: https://github.com/spencerbeggs/okfit/pull/139

[#141]: https://github.com/spencerbeggs/okfit/pull/141

## 0.6.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.5.0 | 0.6.0 |
| @okfit/profiles | dependency | updated | 0.7.0 | 0.7.1 |

### Maintenance

- Changes generation and URL of schema to `@okfot/engine` package.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.5.0

### Features

- `validate` now checks that every `resource` and `sources[].resource` value on a concept resolves to a real file, either relative to the concept's own directory or to the bundle root. URLs, scope descriptions, and glob patterns are recognized as descriptors and skipped, never resolved against the filesystem. This check is controlled by `@okfit/core`'s new `source-resource-missing` lint code and reports nothing when that code is set to `"off"`. [#120][#120]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.16.1 | ^0.16.2 |
| @effected/config-file | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/xdg | dependency | updated | ^0.5.1 | ^0.5.2 |
| @okfit/core | dependency | updated | 0.4.1 | 0.5.0 |
| @okfit/profiles | dependency | updated | 0.6.0 | 0.7.0 |

[#121][#121]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#120]: https://github.com/spencerbeggs/okfit/pull/120

[#121]: https://github.com/spencerbeggs/okfit/pull/121

## 0.4.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/profiles | dependency | updated | 0.5.0 | 0.6.0 |

## 0.4.0

### Features

- `okfit lint [path] [--config] [--format human|json] [--skip-provenance]` runs the same engine call as `okfit validate` but drops the conformance tier from what it collects and reports: exit `1` on a lint or profile error, `0` otherwise, never `2`, and its JSON envelope's `summary.conformance_errors` is always `0`.
- `okfit graph [path] [--config] [--format mermaid|dot|json]` renders the bundle's link graph — frontmatter path fields and body links, including dangling links — as a Mermaid flowchart (the default), GraphViz DOT, or a `GraphEnvelope` JSON document. Always exits `0`; loading never fails on content, so a bundle that fails `validate`'s conformance tier still graphs cleanly.
- `okfit stale [path] [--config] [--format human|json]` lists every concept whose `stale_after` instant has passed as of now (honouring `OKFIT_NOW`), sorted by id, each with how many whole days past it. A report, not a check: always exits `0`, printing a `StaleEnvelope` JSON document under `--format json`. [#93][#93]

* The `okfit validate --format json` envelope (and the MCP `validate_bundle` report, which reuses it) gains a `producer` field naming the package that produced the report: `okfit` from the CLI, `@okfit/mcp` from the MCP server. `okfit_version` was already that package's own version, so the two reports over one bundle legitimately differ there; `producer` labels why. [#91][#91]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.4.0 | 0.4.1 |
| @okfit/profiles | dependency | updated | 0.4.0 | 0.5.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/okfit/pull/91

[#93]: https://github.com/spencerbeggs/okfit/pull/93

## 0.3.0

### Features

- The context envelope's `types[]` entries now carry `required`, `require_verified`, and `fields` — the constraints `validate` enforces for that type — instead of just `name`, `description`, and `guidance`. New exported schemas `ContextField` and `ContextFieldValue` describe one declared field and its enum values.

### Bug Fixes

- `init` now scaffolds `log.md` with a `# Log` title via `Derive.renderLog` instead of a bare entry, so the file's first line is a heading and passes markdownlint's MD041 in a repo that lints the bundle. [#64][#64]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.16.0 | ^0.16.1 |
| @effected/config-file | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/git | dependency | updated | ^0.15.0 | ^0.15.1 |
| @effected/walker | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/xdg | dependency | updated | ^0.5.0 | ^0.5.1 |
| @effected/yaml | dependency | updated | ^0.15.0 | ^0.15.1 |
| @okfit/core | dependency | updated | 0.3.1 | 0.4.0 |
| @okfit/profiles | dependency | updated | 0.3.1 | 0.4.0 |

[#64][#64]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#64]: https://github.com/spencerbeggs/okfit/pull/64

## 0.2.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effected/app | dependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/config-file | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/git | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/glob | dependency | updated | ^0.5.0 | ^0.6.0 |
| @effected/jsonc | dependency | updated | ^0.9.0 | ^0.11.0 |
| @effected/markdown | dependency | updated | ^0.9.1 | ^0.10.0 |
| @effected/store | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/toml | dependency | updated | ^0.6.0 | ^0.7.0 |
| @effected/walker | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/xdg | dependency | updated | ^0.4.1 | ^0.5.0 |
| @effected/yaml | dependency | updated | ^0.14.0 | ^0.15.0 |
| @okfit/core | dependency | updated | 0.3.0 | 0.3.1 |
| @okfit/profiles | dependency | updated | 0.3.0 | 0.3.1 |
| effect | dependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

[#55][#55]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#55]: https://github.com/spencerbeggs/okfit/pull/55

## 0.2.0

### Breaking Changes

- `validate/run.ts#run`'s requirements channel now includes
  `Crypto.Crypto`, alongside the existing `FileSystem.FileSystem |
  Path.Path | Git | GitHistory`. A caller providing `NodeServices.layer`
  or `OkfitPlatform` (as `@okfit/mcp`'s `validateBundle.ts` and the CLI's
  `commands/validate.ts` already do) needs no change; only a caller
  assembling a narrower custom layer for `run` directly must add
  `Crypto.Crypto` to it. [#49][#49]

### Features

- `okfit sync --only generated` (and full `okfit sync`) now leaves a
  concept's `generated.at` untouched when its recorded
  `generated.body_sha256` still matches the current body — this is what
  stops a restamp commit after every squash or rebase merge (issue #19).
  Any other case (no recorded digest, or a mismatched one) writes both
  `generated.at` and `generated.body_sha256` together.
- `okfit verify`'s locate/splice pass generalized to handle both
  `generated.at` and `generated.body_sha256`: when a concept needs both
  fields freshly stamped at the same insertion point, the two edits merge
  into one rather than producing the "overlapping edits" case
  `MarkdownEdit.applyAll` treats as a programmer error.
- `okfit validate --skip-provenance` now narrows to skip only the
  git-derived fallback tier of the `generated-at-drift` lint (the
  date comparison used for a concept with no recorded
  `generated.body_sha256`). The pure, in-memory digest comparison still
  runs and still reports drift for a migrated concept even with the flag
  set — this is what lets an edit-time `validate` stay git-free while
  still catching an edited-but-unstamped body. Previously the flag
  dropped the `generated-at-drift` lint entirely.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.2.0 | 0.3.0 |
| @okfit/profiles | dependency | updated | 0.2.0 | 0.3.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#49]: https://github.com/spencerbeggs/okfit/pull/49

## 0.1.0

### Features

- New package. `@okfit/engine` holds the platform layer (`OkfitPlatform`, `OKFIT_APP_NAMESPACE`), config discovery and resolution, the JSON envelope contracts, and the validate/verify/sync/init/context programs that used to live inside `@okfit/cli`.

- `@okfit/cli` and `@okfit/mcp` are both direct consumers, each importing `@okfit/engine` rather than duplicating this logic or copy-contracting through the CLI

- Enforces its own boundary test: no file under `engine/src` may read `process`

- Assembles the same `OkfitPlatform` layer for both front ends, so the CLI and the MCP server resolve the same user-level config directory structurally [#28][#28]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#28]: https://github.com/spencerbeggs/okfit/pull/28
