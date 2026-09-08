# @okfit/cli

The `okfit` bin: `okfit validate`, `okfit init`, `okfit context`,
`okfit verify`, and `okfit sync` -- the full list is
`okf/interfaces/cli-commands.md`'s to keep, not counted here. Built on
`effect/unstable/cli` for the command tree, flags, and help;
`@effected/cli` for output and failure rendering.

`okfit context` prints the same orientation data (project root, bundle
root, config path, profile, vocabulary) without loading the bundle — cheap
enough for a Claude Code hook to call on every session and every in-bundle
write.

Config loading has two branches (K-10/K-57), chosen once per invocation in
`config/layer.ts#buildConfigLayer`, both built as one `AppConfig.layer`
call (`@effected/app`) rather than a hand-assembled resolver chain:

- **`--config <file>` given:** the path is statted first (`FileSystem.exists`,
  before any layer is built — K-1), then `AppConfig.layer` is built with
  `resolvers: [ConfigResolver.explicitPath(path)]` and `xdg: false`. No
  upward walk, no XDG probe, no `systemEtc` tier.
- **No `--config`:** `AppConfig.layer` with
  `resolvers: [ConfigResolver.upwardWalk({ filenames: [".okfit.toml",
  "okfit.toml", ".config/okfit.toml"], cwd, name: "project" })]` (C-1/C-2,
  ascending to the filesystem root) plus its own `systemEtc` tier (C-5,
  `/etc/okfit/config.toml`, Linux and macOS only) and its default `xdg`/
  `native` tiers (C-4) — personal defaults at
  `$XDG_CONFIG_HOME/okfit/config.toml`, then the native probe.

Exit codes: `0` clean, `1` lint/profile errors, `2` conformance errors, `3`
infrastructure failure, `64` usage error, `130` interrupt. See `README.md`
for the full table and the JSON envelope.

## Layout

```text
src/
  bin.ts               -- wiring only: platform/XDG layer, ShowHelp->64 remap,
                           CliRuntime.reportFailures, CliLogger.layer(), NodeRuntime.runMain
  version.ts           -- CLI_VERSION, read from this package's own package.json
  errors.ts            -- ConfigPathNotFoundError, InitOverwriteError, ConfigMalformedError,
                           VerifyConceptNotFoundError, VerifyUnsupportedFrontmatterError, renderFailure
  commands/
    root.ts            -- rootCommand: subcommands only, no handler
    validate.ts         -- validateCommand: flags/argument, the full handler
    init.ts             -- initCommand: flags/argument, the full handler
    context.ts           -- contextCommand: flags/argument, the full handler. No --profile flag.
    verify.ts             -- verifyCommand: flags/argument, the full handler. No --by flag.
  config/
    layer.ts            -- buildConfigLayer, provideConfig (the K-1 stat-before-layer)
    anchor.ts            -- resolveProjectRoot, resolveBundleRoot (pure)
  context/
    run.ts               -- runContext: index.md stat only, never Bundle.load
  validate/
    run.ts               -- Now (Context.Service), RunOptions (skipProvenance?: boolean, S-31), RunResult, run
  verify/
    locate.ts             -- Located, locate, stripBom, documentNewline (pure)
    splice.ts              -- SpliceTarget, VerifyEntry, splice (pure, never a YAML serialiser)
    run.ts                 -- VerifyOptions, VerifyResult, runVerify: loads the bundle,
                              resolves the actor, splices, and writes atomically
  render/
    context.ts            -- ContextEnvelope/ContextType/ContextTag, contextEnvelope, humanContext (pure)
    verify.ts              -- VerifyEnvelope, VerifyLines, verifyEnvelope, humanVerify (pure)
    sort.ts               -- RenderedDiagnostic, DiagnosticSource, collect, sort (pure)
    human.ts               -- Counts, line, human, summary (pure)
    json.ts                 -- JsonDiagnostic/Envelope/ErrorEnvelope/Summary, json, jsonError (pure)
    exit.ts                  -- Tally, tally, forDiagnostics (pure)
  init/
    scaffold.ts               -- CONFIG_RELATIVE_PATH, ScaffoldOptions, ScaffoldFile,
                                 configValue, targetPaths, files (pure/Effect-typed, no process)
  internal/
    exit.ts                   -- setExitCode(code); the only writer of process.exitCode
    tty.ts                    -- useColor(); the only reader of isTTY/NO_COLOR
  index.ts                    -- public barrel; see "Barrel and @okfit/mcp" below
```

Tests live in `__test__/`, never in `src/`; see `__test__/CLAUDE.md`.

## Rules

- Effect v4 only, at the version in `catalog:effect`. Consult
  `.repos/effect/packages/effect/src/unstable/cli` for `effect/unstable/cli`;
  `node_modules` wins on disagreement.
- **Process/import boundaries (K-9, K-49), enforced by
  `__test__/boundaries.test.ts`.** `process` is read ONLY in `bin.ts`,
  `commands/*.ts`, `internal/exit.ts`, and `internal/tty.ts`. Every file
  under `render/`, `validate/`, `init/`, and `config/anchor.ts` is pure or
  Effect-typed with no `process` access and no `@effect/platform-node`
  import. No file under `src/` imports `App`, `AppStore`, or `AppCache` from
  `@effected/app` — only `AppConfig.layer` (`config/layer.ts`) and, in
  `bin.ts`, `AppDirs`/`Xdg` directly from `@effected/xdg`. This is what keeps
  phase 1 from ever creating a `store.db` or `cache.db`.
- **Dependency closure (K-35).** `package.json`'s `dependencies` block is the
  FULL runtime closure this package's own code, plus core's and profiles'
  peers, needs: `@okfit/core`'s peers
  (`effect`, `@effected/config-file`, `@effected/glob`, `@effected/jsonc`,
  `@effected/markdown`, `@effected/toml`, `@effected/walker`,
  `@effected/yaml`), `@okfit/profiles`'s peers (`@effected/git`,
  `@effected/markdown`, `@okfit/core`), and the CLI's own wiring
  (`@effected/app`, `@effected/cli`, `@effected/xdg`, `@effected/store`,
  `@effect/platform-node`). Several of these are never imported directly by
  a file under `src/` — they satisfy a peer of a dependency this package DOES
  import directly. Do not "clean up" an apparently-unused entry: removing one
  breaks whichever dependency declared it as a peer, at install time, not at
  a lint pass that can catch it. `@okfit/cli` carries no `peerDependencies`
  block itself — it is where core's and profiles' Convention A dependency
  chain terminates, since a CLI bin is installed, never depended on.
- **Barrel and `@okfit/mcp` (K-40).** `src/index.ts` (contract §4) is the
  copy contract for `@okfit/mcp`, planned for a later phase: the pure pieces
  — `run`, the renderers (`collect`/`sort`, `human`/`line`/`summary`,
  `json`/`jsonError`), the exit-code mapper (`tally`/`forDiagnostics`),
  `contextEnvelope`/`humanContext`/`runContext`,
  `verifyEnvelope`/`humanVerify`, the config helpers
  (`resolveProjectRoot`/`resolveBundleRoot`,
  `buildConfigLayer`/`provideConfig`), the scaffold builder
  (`configValue`/`targetPaths`/`files`), and the CLI's typed errors
  (`ConfigPathNotFoundError`/`InitOverwriteError`/`ConfigMalformedError`/
  `VerifyConceptNotFoundError`/`VerifyUnsupportedFrontmatterError`/`renderFailure`)
  — are `@okfit/mcp`'s to import directly from this barrel. `@okfit/mcp`
  never duplicates this logic and never imports `commands/*`, `internal/*`,
  or `bin.ts`, none of which cross the barrel.
- Tests live in `__test__/`, never in `src/`.
- Relative imports use `.js` extensions; built-ins use `node:`. Type imports
  are separate `import type` statements. TSDoc `@public` on every `src/`
  export. Tab indentation.
- `savvy.build.ts` keeps two `ae-forgotten-export` suppressions: `_base`, for
  the inline `Schema.TaggedError` classes (`errors.ts`) rather than
  hand-exporting a synthesized base; and `"Now"`, because `validate/run.ts`'s
  `Now` (`@internal`, not in the barrel — K-49) still appears in
  `rootCommand`'s inferred requirements once a subcommand that reads it is
  registered. Confirmed by removing the `"Now"` suppression and rebuilding:
  `dist/prod/issues.json` comes back non-empty (one `ae-forgotten-export`
  warning naming `Now`) without it.
- `ConfigMalformedError` (`errors.ts`) is a K-63 addition to the contract's
  `src/index.ts` barrel list, not in the original contract text.
- Commits are conventional, DCO signed, and never on `main`.
