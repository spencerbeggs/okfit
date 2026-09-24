# @okfit/cli

## 0.6.7

### Bug Fixes

- `NO_COLOR` now disables colour for any non-empty value, matching the [no-color.org](https://no-color.org) rule. Previously only `NO_COLOR=1` had an effect; `NO_COLOR=true`, `NO_COLOR=yes`, or any other non-empty value was ignored. [#186][#186]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/markdown | dependency | updated | ^0.12.0 | ^0.12.1 |
| @okfit/engine | dependency | updated | 0.8.0 | 0.9.0 |
| @effected/engine | dependency | added | — | ^0.1.0 |

[#186][#186]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#186]: https://github.com/spencerbeggs/okfit/pull/186

## 0.6.6

### Documentation

- `okfit validate`'s text output now reports the line and column of the offending value for lint diagnostics that used to point at the start of the frontmatter block (`unknown-type`, `field-value-unknown`, `actor-prefix-unknown`, `stale`, `require-verified-unmet`), and `generated-at-drift`, `source-resource-missing`, `project-multiple` and `project-not-at-root` now carry a position where they had none. The JSON output's `range` field moves the same way. Tools that parse positions out of the text output should expect the new anchors; the diagnostic codes and files are unchanged. [#179][#179]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.7.4 | 0.8.0 |
| @okfit/engine | dependency | updated | 0.7.5 | 0.8.0 |
| @okfit/profiles | dependency | updated | 0.7.5 | 0.8.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#179]: https://github.com/spencerbeggs/okfit/pull/179

## 0.6.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |
| @effected/cli | dependency | updated | ^0.6.0 | ^0.7.0 |
| @effected/config-file | dependency | updated | ^0.11.1 | ^0.12.0 |
| @effected/git | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/glob | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/jsonc | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/markdown | dependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/toml | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/walker | dependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/yaml | dependency | updated | ^0.16.0 | ^0.17.0 |
| @okfit/core | dependency | updated | 0.7.3 | 0.7.4 |
| @okfit/engine | dependency | updated | 0.7.4 | 0.7.5 |
| @okfit/profiles | dependency | updated | 0.7.4 | 0.7.5 |
| effect | dependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |

[#173][#173]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#173]: https://github.com/spencerbeggs/okfit/pull/173

## 0.6.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | ^0.11.0 | ^0.11.1 |
| @effected/walker | dependency | updated | ^0.10.0 | ^0.11.0 |
| @okfit/core | dependency | updated | 0.7.2 | 0.7.3 |
| @okfit/engine | dependency | updated | 0.7.3 | 0.7.4 |
| @okfit/profiles | dependency | updated | 0.7.4 | 0.7.4 |

[#169][#169]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#169]: https://github.com/spencerbeggs/okfit/pull/169

## 0.6.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effected/cli | dependency | updated | ^0.5.2 | ^0.6.0 |
| @effected/config-file | dependency | updated | ^0.10.1 | ^0.11.0 |
| @effected/git | dependency | updated | ^0.15.2 | ^0.16.0 |
| @effected/glob | dependency | updated | ^0.6.1 | ^0.7.0 |
| @effected/jsonc | dependency | updated | ^0.11.1 | ^0.12.0 |
| @effected/markdown | dependency | updated | ^0.10.1 | ^0.11.0 |
| @effected/toml | dependency | updated | ^0.7.1 | ^0.8.0 |
| @effected/walker | dependency | updated | ^0.9.1 | ^0.10.0 |
| @effected/yaml | dependency | updated | ^0.15.2 | ^0.16.0 |
| @okfit/core | dependency | updated | 0.7.1 | 0.7.2 |
| @okfit/engine | dependency | updated | 0.7.2 | 0.7.3 |
| @okfit/profiles | dependency | updated | 0.7.3 | 0.7.4 |
| effect | dependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |

[#162][#162]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#162]: https://github.com/spencerbeggs/okfit/pull/162

## 0.6.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | ^0.5.1 | ^0.5.2 |
| @effected/config-file | dependency | updated | ^0.10.0 | ^0.10.1 |
| @effected/git | dependency | updated | ^0.15.1 | ^0.15.2 |
| @effected/glob | dependency | updated | ^0.6.0 | ^0.6.1 |
| @effected/jsonc | dependency | updated | ^0.11.0 | ^0.11.1 |
| @effected/markdown | dependency | updated | ^0.10.0 | ^0.10.1 |
| @effected/toml | dependency | updated | ^0.7.0 | ^0.7.1 |
| @effected/walker | dependency | updated | ^0.9.0 | ^0.9.1 |
| @effected/yaml | dependency | updated | ^0.15.1 | ^0.15.2 |
| @okfit/engine | dependency | updated | 0.7.1 | 0.7.2 |

[#156][#156]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#156]: https://github.com/spencerbeggs/okfit/pull/156

## 0.6.1

### Bug Fixes

- fixes pnpm v12 clsure issues

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.7.0 | 0.7.1 |
| @okfit/engine | dependency | updated | 0.7.0 | 0.7.1 |
| @okfit/profiles | dependency | updated | 0.7.2 | 0.7.3 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.6.0

### Features

#### `sync --since` and `sync --staged`

```bash
okfit sync --since 2026-09-01   # log mode's inclusive floor
okfit sync --staged             # pre-commit mode
```

- `--since <YYYY-MM-DD>` sets log mode's inclusive floor, overriding the default of the newest date already in `log.md`.

- `--staged` stamps only the concepts currently in the git index — meant for a pre-commit hook — using `now` as `generated.at` and re-adding what's written. It defaults `--only` to `generated` and `index`; combining it with `--only log` fails at exit `64`.

#### `verify --all` and `verify --type`

- The concept id is now optional. Pass `--all` to attest every unverified concept whose type declares `require_verified`, or `--type <Type>` (repeatable) to narrow (or, without `--all`, define) the batch:

```bash
okfit verify --all
okfit verify --type Decision --type Convention
```

- Giving both an id and `--all`/`--type`, or neither, fails with a usage error at exit `64`. Passing an id positional together with `--all`/`--type` and no separate path is no longer ambiguous: the token is read as the project root, since an id is meaningless in batch mode.

- The human `sync` reason for `generated-missing` now names the fix directly — "has no generated block and actors.agent is not configured; set generated.by by hand or configure actors.agent" — instead of just describing the gap. With `actors.agent` configured, `okfit validate` now warns `generated-missing` for a concept sync would otherwise have to skip, rather than staying silent about it. [#141][#141]

#### Distribution-aware `main()`

- `main()` now accepts an options object of the new exported `MainOptions` type:

```ts
import { main } from "@okfit/cli/main";

main({ distribution: { name: "@okfit/plugin", version: "0.3.7" } });
```

- Passing a `distribution` threads it into every `--format json` envelope. Omit it (or call `main()` with no arguments) for a direct install of `@okfit/cli`, which reports `distribution: null`.

#### `okfit --version` output

- Widened to report every version that determines what a report says and what a config may contain:

```text
okfit 0.5.4 (engine 0.6.0, okf 0.2, config-schema 1.0)
okfit 0.5.4 via @okfit/plugin 0.3.7 (engine 0.6.0, okf 0.2, config-schema 1.0)
```

- replacing the previous `okfit v<version>` form. [#139][#139]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.6.0 | 0.7.0 |
| @okfit/engine | dependency | updated | 0.6.0 | 0.7.0 |
| @okfit/profiles | dependency | updated | 0.7.1 | 0.7.2 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#139]: https://github.com/spencerbeggs/okfit/pull/139

[#141]: https://github.com/spencerbeggs/okfit/pull/141

## 0.5.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.5.0 | 0.6.0 |
| @okfit/engine | dependency | updated | 0.5.0 | 0.6.0 |
| @okfit/profiles | dependency | updated | 0.7.0 | 0.7.1 |

## 0.5.3

### Bug Fixes

- `validate` now surfaces two additional lint diagnostics from `@okfit/core`/`@okfit/engine`: `status-missing` (off by default) and `source-resource-missing` (warn by default), plus more accurate `broken-links` reporting for links whose target file exists but is missing the linked heading.
- `sync`'s generated `index.md` entries now escape markdown-active characters in concept titles and descriptions, so text containing them (``\ < > * _ ` [ ]``) renders as literal characters instead of broken formatting. [#120][#120]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | ^0.4.1 | ^0.5.1 |
| @effected/config-file | dependency | updated | ^0.9.0 | ^0.10.0 |
| @okfit/core | dependency | updated | 0.4.1 | 0.5.0 |
| @okfit/engine | dependency | updated | 0.4.1 | 0.5.0 |
| @okfit/profiles | dependency | updated | 0.6.0 | 0.7.0 |

[#121][#121]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#120]: https://github.com/spencerbeggs/okfit/pull/120

[#121]: https://github.com/spencerbeggs/okfit/pull/121

## 0.5.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/engine | dependency | updated | 0.4.0 | 0.4.1 |
| @okfit/profiles | dependency | updated | 0.5.0 | 0.6.0 |

## 0.5.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.4.0 | 0.4.1 |
| @okfit/engine | dependency | updated | 0.3.0 | 0.4.0 |
| @okfit/profiles | dependency | updated | 0.4.0 | 0.5.0 |

## 0.5.0

### Features

- `okfit context`'s `human` output now renders each type's constraints under its bullet: required keys, whether `verified` is required, and its declared fields with their enum values or `path` kind — so the same information a lint error would otherwise be the first place to reveal is visible up front. [#64][#64]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | ^0.4.0 | ^0.4.1 |
| @effected/config-file | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/git | dependency | updated | ^0.15.0 | ^0.15.1 |
| @effected/walker | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/yaml | dependency | updated | ^0.15.0 | ^0.15.1 |
| @okfit/core | dependency | updated | 0.3.1 | 0.4.0 |
| @okfit/engine | dependency | updated | 0.2.1 | 0.3.0 |
| @okfit/profiles | dependency | updated | 0.3.1 | 0.4.0 |

[#64][#64]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#64]: https://github.com/spencerbeggs/okfit/pull/64

## 0.4.1

### Refactoring

- Ports every command to the rc.113 PascalCase CLI constructors (`Flag.String`, `Flag.Boolean`, `Flag.File`, `Flag.Literals`, `Argument.Path`, and friends); parsing, help output and exit codes are unchanged. [#55][#55]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effected/cli | dependency | updated | ^0.3.1 | ^0.4.0 |
| @effected/config-file | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/git | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/glob | dependency | updated | ^0.5.0 | ^0.6.0 |
| @effected/jsonc | dependency | updated | ^0.9.0 | ^0.11.0 |
| @effected/markdown | dependency | updated | ^0.9.1 | ^0.10.0 |
| @effected/toml | dependency | updated | ^0.6.0 | ^0.7.0 |
| @effected/walker | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/yaml | dependency | updated | ^0.14.0 | ^0.15.0 |
| @okfit/core | dependency | updated | 0.3.0 | 0.3.1 |
| @okfit/engine | dependency | updated | 0.2.0 | 0.2.1 |
| @okfit/profiles | dependency | updated | 0.3.0 | 0.3.1 |
| effect | dependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

[#55][#55]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#55]: https://github.com/spencerbeggs/okfit/pull/55

## 0.4.0

### Breaking Changes

- `okfit validate --skip-provenance` no longer silences the
  `generated-at-drift` lint entirely (issue #19). It now skips only the
  git-derived fallback check — the one used for a concept with no
  recorded `generated.body_sha256`. A bundle that has run `okfit sync`
  since this field was introduced still gets checked with the flag set:
  the comparison is over text already in memory, so it spawns no git
  process and still reports a body edited without a re-stamp. Anyone
  scripting around `--skip-provenance` to fully suppress
  `generated-at-drift` for a migrated bundle will start seeing that
  diagnostic again. [#49][#49]

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

### Breaking Changes

#### Public API surface narrowed to the CLI's own surface

- `@okfit/cli`'s barrel (`@okfit/cli`) no longer re-exports `@okfit/engine`'s public surface. `@okfit/cli` is now a presentation shell: commands, human renderers, `renderFailure`, and the bin/main wiring. The platform layer, config discovery, and the validate/verify/sync/init/context programs moved to `@okfit/engine` in a prior release; this release removes the compatibility re-export, so those symbols moved rather than disappeared.

- The following are no longer exported from `@okfit/cli` — import them from `@okfit/engine` instead:

- Types: `ContextResult`, `ContextRunOptions`, `DiagnosticSource`, `DiscoveredConfig`, `RenderedDiagnostic`, `ResolveProjectConfigInput`, `ResolvedProjectConfig`, `RunOptions`, `RunResult`, `ScaffoldFile`, `ScaffoldOptions`, `Tally`

- Values: `CONFIG_RELATIVE_PATH`, `ConfigMalformedError`, `ConfigPathNotFoundError`, `ContextEnvelope`, `ContextTag`, `ContextType`, `DEFAULT_PROFILE_NAME`, `InitOverwriteError`, `JsonDiagnostic`, `JsonEnvelope`, `JsonErrorEnvelope`, `JsonSummary`, `VerifyConceptNotFoundError`, `VerifyEnvelope`, `VerifyUnsupportedFrontmatterError`, `buildConfigLayer`, `collect`, `configValue`, `contextEnvelope`, `files`, `forDiagnostics`, `json`, `jsonError`, `provideConfig`, `resolveBundleRoot`, `resolveProjectConfig`, `resolveProjectRoot`, `run`, `runContext`, `sort`, `tally`, `targetPaths`, `verifyEnvelope`

- The re-exported `ConfigReadError` type (originally from `@effected/config-file`) is also dropped; it was never part of `renderFailure`'s public contract.

- Everything else — `rootCommand`, `renderFailure`, `humanContext`, `human`, `line`, `summary`, the `Counts` type, `VerifyLines`, `humanVerify`, `CLI_VERSION` — is unchanged and stays defined in `@okfit/cli`.

- `@okfit/cli`'s `./main` export condition (`src/main.ts`, the assembled program) is also now supported public surface — it is what `@okfit/plugin`'s bin shims import. [#28][#28]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | removed | ^0.15.0 | — |
| @effected/store | dependency | removed | ^0.7.0 | — |
| @effected/xdg | dependency | removed | ^0.4.1 | — |
| @okfit/engine | dependency | added | — | 0.1.0 |

[#28][#28]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#28]: https://github.com/spencerbeggs/okfit/pull/28

## 0.2.0

### Features

- First usable release of `@okfit/cli`: the `okfit` command line for OKF v0.2 bundles, built on `@okfit/core` and `@okfit/profiles`.

```bash
pnpm add -D @okfit/cli
okfit validate
```

#### `okfit validate`

- Loads the config, loads the bundle, runs conformance and lint checks, runs the resolved profile's own checks, and renders every diagnostic — one line per diagnostic to stdout (`<file>:<line>:<col> <severity> <code> <message>`, or `(bundle)` for a bundle-level diagnostic), then a summary line to stderr. `--skip-provenance` skips the `generated-at-drift` lint's git tier for a single run without touching the project's `[lint]` table.

#### `okfit init`

- Scaffolds a fresh bundle — a thin `.config/okfit.toml`, the bundle's `index.md` files, a `project.md` stub, and an initial `log.md` entry — then self-validates the result and exits with `validate`'s own exit code. It never overwrites: if any target path already exists, nothing is written and the command exits `3`. `--profile <name>` picks which profile to scaffold.

#### `okfit context`

- Prints the resolved project root, bundle root, config path, profile, and vocabulary without loading the bundle — cheap enough to call on every session or every in-bundle write.

#### `okfit verify`

- Appends one attestation, `{ by: human:<id>, at: <now> }`, to a concept's `verified` list and writes the file back atomically. The actor is always your own resolved git identity; existing entries are never touched. `--at <iso>` records a different instant; `--dry-run` prints what would be written without touching the file. This is a human-run command — no agent, hook, or MCP tool ever invokes it.

#### `okfit sync`

- Regenerates every derived-content family in one command: `generated.at` per concept (computed from git history), `index.md` for every directory that holds a concept, and `log.md` (the root log, curated prose topped up by date). Runs all three modes in order unless narrowed with one or more `--only` flags; `--dry-run` computes every result and writes nothing.

#### Exit codes and JSON envelopes

- A consistent exit-code contract across every subcommand — `130` interrupted, `64` usage error, `3` infrastructure failure, `2` conformance errors, `1` lint or profile errors, `0` otherwise, higher always winning. `--format json` on `validate`, `context`, `verify`, and `sync` prints one machine-readable envelope per command (`JsonEnvelope`, `ContextEnvelope`, `VerifyEnvelope`, `SyncEnvelope`) to stdout, with warnings and summaries kept on stderr.

#### Config discovery

- With no `--config` flag, `okfit` walks upward from the project root checking `.okfit.toml`, `okfit.toml`, then `.config/okfit.toml` in each directory, then falls back to the XDG, OS-native, and system config tiers. `--config <file>` bypasses discovery entirely and is a hard failure if the path does not exist. [#16][#16]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
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
| @okfit/profiles | dependency | updated | 0.0.0 | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!
