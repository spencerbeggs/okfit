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
  at: 2026-09-09T05:07:51Z
---

# CLI

## Purpose

`@okfit/cli` is the `okfit` bin: `okfit validate`, `okfit init`,
`okfit context`, `okfit verify`, and `okfit sync`; built on
`effect/unstable/cli` for the
command tree,
flags, and help, and `@effected/cli` for output and failure rendering. It
is a presentation shell over [Engine](engine.md): config discovery and the
validate/verify/sync/init/context programs live in `@okfit/engine`, not
here (`packages/cli/CLAUDE.md:1-8`). `okfit context` prints the same
orientation data (project root, bundle root, config path, profile,
vocabulary) without loading the bundle -- cheap enough for a Claude Code
hook to call on every session and every in-bundle write.

## Config discovery and exit codes

Config loading has two branches, chosen once per invocation, never one
chain with a conditional resolver list (K-10/K-57), assembled in
[Engine](engine.md)'s `config/layer.ts#buildConfigLayer` as ONE
`AppConfig.layer(OkfitConfigFile, ...)` call varying only the chain
options: `--config <file>` given -- the path is statted first, then the
layer carries only `resolvers: [ConfigResolver.explicitPath(path)]` and
`xdg: false`, no upward walk, no XDG probe. No `--config` -- the layer
carries `resolvers: [ConfigResolver.upwardWalk({ filenames: [".okfit.toml",
"okfit.toml", ".config/okfit.toml"], name: "project" })]` and
`systemEtc: true`, landing personal defaults at
`$XDG_CONFIG_HOME/okfit/config.toml` (`xdg`/`native` stay on their
defaults) and system defaults at `/etc/okfit/config.toml`. A
`ConfigCodecError`/`ConfigValidationError` from either branch is wrapped
into `ConfigMalformedError` naming the failing path. Exit codes: `0`
clean, `1` lint/profile errors, `2` conformance errors, `3` infrastructure
failure, `64` usage error, `130` interrupt (`packages/cli/CLAUDE.md`).

## Process and dependency boundaries

`process` is read only in `bin.ts`, `main.ts`, every file under
`commands/`, `internal/exit.ts`, `internal/tty.ts`, and `version.ts`;
everything under `render/` is pure or Effect-typed with no `process`
access and no `@effect/platform-node` import (`packages/cli/CLAUDE.md`,
K-9/K-49). This package no longer imports `@effected/app` at all -- config
discovery moved to [Engine](engine.md). `package.json`'s `dependencies`
block is the full runtime closure this package's own code, plus core's and
profiles' peers, need -- not a list to "clean up" for apparently-unused
entries (`packages/cli/CLAUDE.md`, K-35). `@okfit/engine` declares no
`peerDependencies` of its own, so nothing here satisfies one on engine's
behalf.
