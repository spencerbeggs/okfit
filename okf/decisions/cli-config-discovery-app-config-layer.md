---
type: Decision
title: Config discovery is assembled through AppConfig.layer, not a hand-rolled resolver chain
description: The CLI resolves project config through @effected/app's AppConfig.layer, varying only its resolvers/xdg/systemEtc options per branch, rather than building ConfigFile.layer directly with a hand-rolled projectResolver.
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-10-11T14:44:29Z
status: stable
verified:
  - by: human:spencer
    at: 2026-09-08T02:12:59Z
  - by: human:spencer
    at: 2026-10-11T14:21:44Z
integrity:
  generated:
    body: 31be4989b93de26a
  verified:
    by: human:spencer
    at: 2026-10-11T14:21:44Z
    content: 359e4d7a648cefde
---

# Config discovery is assembled through AppConfig.layer, not a hand-rolled resolver chain

## Context

Project config follows the config-dir convention (as git-cliff and Tombi
do): from the discovery start up to the filesystem root, each directory is
checked for `.okfit.toml`, then `okfit.toml`, then `.config/okfit.toml`,
and the first file found anywhere wins -- no `.git` probe, no ceiling --
then XDG, native, and system. The convention replaced an earlier shape
that hard-coded two project-local filenames (a `config.toml` under
`.config/okfit/` and `okfit.config.toml`) and offered no path to a third;
SchemaStore's `fileMatch` hygiene lint also rejects a generic basename
such as `config.toml`. A per-resolver approximation (three `upwardWalk`
resolvers in precedence order) was rejected because `ConfigFile.discover`
exhausts one resolver before starting the next, so a parent's dotfile
would beat a child's plain name.

The first implementation assembled the resolver list by hand --
`projectResolver`, `XdgConfig.resolver`, `XdgConfig.nativeResolver`,
`ConfigResolver.systemEtc` -- and handed it to `ConfigFile.layer`,
because `AppConfig.layer` then "appends its own XDG pair after the
caller's resolvers and offers no hook past them." `@effected/app`
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
re-deriving it from the discovered path's tail. The anchor each winning source yields:

| Winning source | Anchor |
| --- | --- |
| `<dir>/.okfit.toml` or `<dir>/okfit.toml` | `<dir>` |
| `<dir>/.config/okfit.toml` | `<dir>` (parent of `.config`) |
| `--config <p>` where `basename(dirname(p)) === ".config"` (any file name) | `dirname(dirname(p))` |
| `--config <p>`, any other shape | `dirname(p)` |
| resolver `"xdg"`, `"native"`, `"system"` | `cwd` |
| nothing found | `cwd` |

An explicit `--config` short-circuits to exactly one resolver, so an
unrelated ambient config file can never merge into the one the caller
named; a single chain that always included the upward walk and XDG would
contradict what "explicit" means.

## Alternatives rejected

Keeping the hand-rolled `projectResolver` plus `ConfigFile.layer` was the
prior mechanism and still works, but it duplicates logic `AppConfig.layer`
now owns upstream and it string-matched the discovered path's tail to
compute the anchor rather than reading the resolver's own reported `dir`
-- the one remaining place in `resolve.ts`/`anchor.ts`'s config path that
could have used `ConfigSource.match` and did not.

## Consequences

This repo's own config lives at `.config/okfit.toml` and is found from any
subdirectory with no flag; `init` refuses when any of the three
project-level names already exists.
