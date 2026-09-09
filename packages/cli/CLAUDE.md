# @okfit/cli

The `okfit` bin: `okfit validate`, `okfit init`, `okfit context`,
`okfit verify`, and `okfit sync` -- the full list is
`okf/interfaces/cli-commands.md`'s to keep, not counted here. Built on
`effect/unstable/cli` for the command tree, flags, and help;
`@effected/cli` for output and failure rendering. This package is a
presentation shell over `@okfit/engine`: config discovery and the
validate/verify/sync/init/context programs live there, not here -- see
`okf/decisions/engine-front-end-split.md`.

`okfit context` prints the same orientation data (project root, bundle
root, config path, profile, vocabulary) without loading the bundle — cheap
enough for a Claude Code hook to call on every session and every in-bundle
write.

Config loading has two branches (K-10/K-57), chosen once per invocation in
`@okfit/engine`'s `config/layer.ts#buildConfigLayer`, both built as one
`AppConfig.layer` call (`@effected/app`) rather than a hand-assembled
resolver chain:

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
  bin.ts               -- the shebang entry point: imports and calls main(), nothing else
  main.ts               -- the assembled program: resolves Now, provides OkfitPlatform,
                            CliRuntime.reportFailures, NodeRuntime.runMain
  index.ts               -- public barrel: the pure pieces @okfit/mcp could import, plus
                             this package's own renderFailure and rootCommand
  version.ts              -- CLI_VERSION, read from process.env.__PACKAGE_VERSION__ (K-32), a
                              build-time constant the bundler injects -- never a package.json
                              import, which would report engine's version for anything that
                              moved there
  errors.ts                -- renderFailure and its private helpers only; the typed error
                              classes themselves (ConfigPathNotFoundError,
                              InitOverwriteError, ConfigMalformedError,
                              VerifyConceptNotFoundError,
                              VerifyUnsupportedFrontmatterError) live in @okfit/engine now
  commands/
    root.ts               -- rootCommand: subcommands only, no handler
    validate.ts            -- validateCommand: flags/argument, the full handler
    init.ts                 -- initCommand: flags/argument, the full handler
    context.ts                -- contextCommand: flags/argument, the full handler
    verify.ts                  -- verifyCommand: flags/argument, the full handler
    sync.ts                     -- syncCommand: flags/argument, the full handler
  render/
    context.ts                  -- humanContext (human half; the envelope half is
                                    @okfit/engine's ContextEnvelope/contextEnvelope)
    human.ts                     -- Counts, line, human, summary (validate's human renderer)
    sync.ts                       -- humanSync (human half of @okfit/engine's SyncEnvelope)
    verify.ts                      -- VerifyLines, humanVerify (human half of @okfit/engine's
                                      VerifyEnvelope)
  internal/
    exit.ts                       -- setExitCode(code); the only writer of process.exitCode
    tty.ts                         -- useColor(); the only reader of isTTY/NO_COLOR
```

This tree names files and their headline exports, not every symbol a file
exports -- it is a map, not a substitute for reading the source before
relying on its export list.

Tests live in `__test__/`, never in `src/`; see `__test__/CLAUDE.md`.

## Rules

- Effect v4 only, at the version in `catalog:effect`. Consult
  `.repos/effect/packages/effect/src/unstable/cli` for `effect/unstable/cli`;
  `node_modules` wins on disagreement.
- **Process boundary (K-9, K-49), enforced by `__test__/boundaries.test.ts`.**
  `process` is read ONLY in `bin.ts`, `main.ts`, every file under
  `commands/`, `internal/exit.ts`, `internal/tty.ts`, and `version.ts`
  (`version.ts`'s `process.env.__PACKAGE_VERSION__` is a build-time constant
  the bundler replaces, not a runtime environment read -- allowlisted
  alongside the deliberate touchpoints for that reason). Every file under
  `render/` is pure or Effect-typed with no `process` access and no
  `@effect/platform-node` import. This package no longer imports `App`,
  `AppStore`, or `AppCache` from `@effected/app` at all -- config discovery,
  and the `AppConfig.layer` call that needs `@effected/app`, both live in
  `@okfit/engine`'s `config/layer.ts` now.
- **Dependency closure (K-35).** `package.json`'s `dependencies` block is the
  FULL runtime closure this package's own code, plus core's and profiles'
  peers, need: `@okfit/core`'s peers (`effect`, `@effected/config-file`,
  `@effected/glob`, `@effected/jsonc`, `@effected/markdown`,
  `@effected/toml`, `@effected/walker`, `@effected/yaml`), `@okfit/profiles`'s
  peers (`@effected/git`, `@effected/markdown`, `@okfit/core`), and the
  CLI's own wiring (`@effect/platform-node` for `NodeRuntime`,
  `@effected/cli`). `@okfit/engine` itself declares no `peerDependencies` —
  there is nothing of engine's to satisfy here. Several
  of these are never imported directly by a file under `src/` — they satisfy
  a peer of a dependency this package DOES import directly. Do not "clean up"
  an apparently-unused entry: removing one breaks whichever dependency
  declared it as a peer, at install time, not at a lint pass that can catch
  it. `@okfit/cli` carries no `peerDependencies` block itself — it is where
  core's and profiles' Convention A dependency chain terminates, since a CLI
  bin is installed, never depended on.
- Tests live in `__test__/`, never in `src/`.
- Relative imports use `.js` extensions; built-ins use `node:`. Type imports
  are separate `import type` statements. TSDoc `@public` on every `src/`
  export. Tab indentation.
- `savvy.build.ts` carries no `meta.tsdoc.suppressWarnings` block. It once
  suppressed two `ae-forgotten-export` warnings (`_base`, `"Now"`) for
  symbols that have since moved to `@okfit/engine`; removing the block and
  rebuilding confirms `dist/prod/issues.json`'s `warnings` array is still
  empty, so nothing here needs the suppression any more.
- Commits are conventional, DCO signed, and never on `main`.
