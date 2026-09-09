# @okfit/cli

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
