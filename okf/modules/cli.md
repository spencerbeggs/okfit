---
type: Module
title: CLI
description: The okfit command line -- validate, init, context, and verify, built on effect/unstable/cli and @effected/cli.
resource: ../../packages/cli
kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-08T14:33:59Z
---

# CLI

## Purpose

`@okfit/cli` is the `okfit` bin: `okfit validate`, `okfit init`,
`okfit context`, `okfit verify`, and `okfit sync`; built on
`effect/unstable/cli` for the
command tree,
flags, and help, and `@effected/cli` for output and failure rendering.
`okfit context` prints the same orientation data (project root, bundle
root, config path, profile, vocabulary) without loading the bundle -- cheap
enough for a Claude Code hook to call on every session and every in-bundle
write (`packages/cli/CLAUDE.md:1-10`).

## Config discovery and exit codes

Config loading has two branches, chosen once per invocation, never one
chain with a conditional resolver list (`packages/cli/CLAUDE.md:12-26`,
K-10/K-57), and both are now ONE `AppConfig.layer(OkfitConfigFile, ...)`
call varying only the chain options
(`packages/cli/src/config/layer.ts:50-82`): `--config <file>` given -- the
path is statted first, then the layer carries only
`resolvers: [ConfigResolver.explicitPath(path)]` and `xdg: false`, no
upward walk, no XDG probe. No `--config` -- the layer carries
`resolvers: [ConfigResolver.upwardWalk({ filenames: [".okfit.toml",
"okfit.toml", ".config/okfit.toml"], name: "project" })]` and
`systemEtc: true`, landing personal defaults at
`$XDG_CONFIG_HOME/okfit/config.toml` (`xdg`/`native` stay on their
defaults) and system defaults at `/etc/okfit/config.toml`. The project-root
anchor reads the discovered source's `match.dir` for a `"project"`-named
match (`packages/cli/src/config/anchor.ts:63-79`) instead of string-matching
the path's tail; `--config` keeps its own basename-based rule
(`anchorForExplicit`, `packages/cli/src/config/anchor.ts:36-39`). A
`ConfigCodecError`/`ConfigValidationError` from either branch is wrapped
into `ConfigMalformedError` naming the failing path, falling back to
`explicitConfigPath` only when the library's own path is unset
(`packages/cli/src/config/layer.ts:100-114`). Exit codes: `0`
clean, `1` lint/profile errors, `2` conformance errors, `3` infrastructure
failure, `64` usage error, `130` interrupt (`packages/cli/CLAUDE.md:28-30`).

## Process and dependency boundaries

`process` is read only in `bin.ts`, `commands/*.ts`, `internal/exit.ts`,
and `internal/tty.ts`; everything under `render/`, `validate/`, `init/`,
and `config/anchor.ts` is pure or Effect-typed with no `process` access and
no `@effect/platform-node` import (`packages/cli/CLAUDE.md:73-81`,
K-9/K-49). `package.json`'s `dependencies` block is the full runtime
closure this package's own code, plus core's and profiles' peers, need --
not a list to "clean up" for apparently-unused entries
(`packages/cli/CLAUDE.md:82-96`, K-35).

## The `@okfit/mcp` barrel contract

`src/index.ts` is the copy contract for `@okfit/mcp`, planned for a later
phase: the pure pieces (`run`, the renderers, the exit-code mapper,
`contextEnvelope`/`humanContext`/`runContext`, the config helpers, the
scaffold builder, the CLI's typed errors) are `@okfit/mcp`'s to import
directly from this barrel; `@okfit/mcp` never duplicates this logic and
never imports `commands/*`, `internal/*`, or `bin.ts`
(`packages/cli/CLAUDE.md:97-108`, K-40).
