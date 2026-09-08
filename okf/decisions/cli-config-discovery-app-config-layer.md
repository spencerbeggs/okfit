---
type: Decision
title: Config discovery is assembled through AppConfig.layer, not a hand-rolled resolver chain
description: The CLI resolves project config through @effected/app's AppConfig.layer, varying only its resolvers/xdg/systemEtc options per branch, rather than building ConfigFile.layer directly with a hand-rolled projectResolver.
tags:
  - architecture
generated:
  by: okfit/claude-code
status: draft
supersedes: cli-config-discovery-config-dir.md
---

# Config discovery is assembled through AppConfig.layer, not a hand-rolled resolver chain

## Context

`cli-config-discovery-config-dir.md` recorded the config-dir precedence
(`.okfit.toml`, `okfit.toml`, `.config/okfit.toml` per directory, ascending
to the filesystem root, then XDG, native, and system) and named the
mechanism as `@okfit/cli` assembling its own resolver list --
`projectResolver`, `XdgConfig.resolver`, `XdgConfig.nativeResolver`,
`ConfigResolver.systemEtc` -- by hand and handing it to `ConfigFile.layer`,
explicitly rejecting `AppConfig.layer` because "it appends its own XDG pair
after the caller's resolvers and offers no hook past them." `@effected/app`
0.15.0's `AppConfig.layer` closed that gap: it now accepts `resolvers`,
`xdg`, and `systemEtc` as options rather than always appending its own XDG
pair, so the earlier objection no longer holds.

## Decision

`buildConfigLayer` (`packages/cli/src/config/layer.ts:50-82`) is ONE
`AppConfig.layer(OkfitConfigFile, ...)` call in both branches; only the
chain options vary:

- `--config <file>` given: `resolvers: [ConfigResolver.explicitPath(path)]`,
  `xdg: false` -- exactly one resolver, no `systemEtc` tier either.
- No `--config`: `resolvers: [ConfigResolver.upwardWalk({ filenames:
  [".okfit.toml", "okfit.toml", ".config/okfit.toml"], cwd, name: "project"
  })]`, `systemEtc: true`; `xdg` and `native` stay on `AppConfig.layer`'s own
  defaults, which is what puts personal defaults at
  `$XDG_CONFIG_HOME/okfit/config.toml` and the native probe behind it.

The `upwardWalk` resolver is named `"project"` so
`resolveProjectRoot` (`packages/cli/src/config/anchor.ts:63-79`) can read
the winning source's `match.dir` directly for the anchor, instead of
re-deriving it from the discovered path's tail. The discovery order and
precedence table `cli-config-discovery-config-dir.md` recorded are
UNCHANGED; only the mechanism that assembles the chain and reads the anchor
is different.

## Alternatives rejected

Keeping the hand-rolled `projectResolver` plus `ConfigFile.layer` was the
prior mechanism and still works, but it duplicates logic `AppConfig.layer`
now owns upstream and it string-matched the discovered path's tail to
compute the anchor rather than reading the resolver's own reported `dir`
-- the one remaining place in `resolve.ts`/`anchor.ts`'s config path that
could have used `ConfigSource.match` and did not.

## Consequences

`cli-config-discovery-config-dir.md` is deprecated and superseded by this
Decision for the mechanism; its precedence table and discovery-order prose
stay correct and are not restated wholesale here.
