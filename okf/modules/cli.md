---
type: Module
title: CLI
description: The okfit command line -- validate, init, context, and verify, built on effect/unstable/cli and @effected/cli.
status: stable
resource: ../../packages/cli
kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-24T15:35:44Z
  body_sha256: 77a89ee484268185b8d274f21987f596e5d59577ccade778455cd88e644018e5
---

# CLI

## Purpose

`@okfit/cli` is the `okfit` bin: `okfit validate`, `okfit init`,
`okfit context`, `okfit verify`, and `okfit sync`; built on
`effect/unstable/cli` for the command tree, flags, and help, and
`@effected/cli`'s `CliRuntime.main`/`CliColor` for assembly, failure
rendering, and colour. It
is a presentation shell over [Engine](engine.md): config discovery and the
validate/verify/sync/init/context programs live in `@okfit/engine`, not
here (`packages/cli/CLAUDE.md:1-8`). The distribution comes from
`@effected/engine`'s `CurrentDistribution` reference; `Distribution`
itself is re-exported from `@effected/engine` too -- see [okfit's front
ends build on @effected/{engine,cli,mcp} rather than hand-rolled
equivalents](../decisions/front-ends-adopt-the-effected-kit.md). `okfit context` prints the same
orientation data (project root, bundle root, config path, profile,
vocabulary) without loading the bundle -- cheap enough for a Claude Code
hook to call on every session and every in-bundle write. `verify` also
takes `--all` and `--type <Type>` (repeatable) to attest a whole selection
at once instead of one id at a time, and `sync` also takes `--since
<YYYY-MM-DD>` (widens the log floor) and `--staged` (the pre-commit
shape: stamps only the git index with `now` and re-adds what it writes)
-- see [Engine](engine.md) for what each does; this package only threads
the flags through.

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
`commands/`, `internal/exit.ts`, and `version.ts`
(`CLI_VERSION`, one of the three numbers `okfit --version` prints beside
`ENGINE_VERSION` and `OKF_SPEC_VERSION`; `main(options?)` accepts the
`distribution` the meta-package's bin shim passes through — see [The
engine version, not the producer version, is what a report is compared
on](../decisions/engine-version-is-the-comparable-version.md)).
`internal/tty.ts`, this package's former sole reader of `isTTY`/
`NO_COLOR`, is deleted: colour is now `@effected/cli`'s `CliColor`
decision, read through the ambient `ConfigProvider` rather than
`process` -- a **user-visible change**: `NO_COLOR` used to disable colour
only when it was exactly `1`; now any non-empty value does, the
no-color.org rule.
Everything under `render/` is pure or Effect-typed with no `process`
access and no `@effect/platform-node` import (`packages/cli/CLAUDE.md`,
K-9/K-49). This package no longer imports `@effected/app` at all -- config
discovery moved to [Engine](engine.md), enforced as a blanket
`{ forbidImports: ["@effected/app"] }` `SourceBoundary` rule (from
`@effected/workspaces/testing`), broader than a three-name
(`App`/`AppStore`/`AppCache`) allowlist. `package.json`'s `dependencies`
block is the full runtime closure this package's own code, plus core's and
profiles' peers, need -- not a list to "clean up" for apparently-unused
entries (`packages/cli/CLAUDE.md`, K-35). `@okfit/engine` declares no
`peerDependencies` of its own, so nothing here satisfies one on engine's
behalf.
