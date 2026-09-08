---
type: Decision
title: Config discovery follows the config-dir convention
description: The CLI resolves project config through three per-directory names in config-dir precedence, ascending to the filesystem root, then the XDG, native, and system tiers, never a fixed pair of filenames.
tags:
  - architecture
generated:
  by: okfit/claude-code
status: stable
supersedes: cli-config-discovery-two-branches.md
verified:
  - by: human:spencer
    at: 2026-09-08T00:07:54Z
---

# Config discovery follows the config-dir convention

## Context

The config-dir convention lets a tool's config live either as a dotfile at
the project root, a plain file at the project root, or a namespaced file
under `.config/`, with the first of those found anywhere from the current
directory up to the filesystem root winning. Tombi and git-cliff both ship
this precedent: git-cliff's own SchemaStore entry is accepted as
`["cliff.toml", ".cliff.toml", "**/.config/cliff.toml", …]`. Separately, the
SchemaStore `fileMatch` hygiene lint enforces a `GENERIC_BASENAMES` set
(`conf, config, configuration, options, settings`) that would have rejected
the old discovered basename `config.toml` outright.

## Decision

Project discovery is one per-directory algorithm: from the discovery start
up to the filesystem root, each directory is checked for `.okfit.toml`,
then `okfit.toml`, then `.config/okfit.toml`, and the first file found
anywhere wins; no `.git` probe and no ceiling. Then the chain:
`projectResolver`, `XdgConfig.resolver`, `XdgConfig.nativeResolver`,
`ConfigResolver.systemEtc`, assembled by `@okfit/cli` itself and handed to
`ConfigFile.layer` — `AppConfig.layer` is no longer used for discovery
because it appends its own XDG pair after the caller's resolvers and offers
no hook past them. The filename inside every namespaced directory stays
`config.toml`.

| Winning source | Anchor |
| --- | --- |
| `<dir>/.okfit.toml` or `<dir>/okfit.toml` | `<dir>` |
| `<dir>/.config/okfit.toml` | `<dir>` (parent of `.config`) |
| `--config <p>` where `basename(dirname(p)) === ".config"` (any file name) | `dirname(dirname(p))` |
| `--config <p>`, any other shape | `dirname(p)` |
| resolver `"xdg"`, `"native"`, `"system"` | `cwd` |
| nothing found | `cwd` |

Two behaviour changes follow that no earlier concept names: an explicit
`--config .config/okfit.toml` now anchors at the parent of `.config` rather
than at `.config` itself; and a matched `.okfit.toml`/`okfit.toml` anchors
at its own directory, a case the old chain could not produce.

## Alternatives rejected

The per-resolver approximation — three `upwardWalk` resolvers in precedence
order — lets a parent's dotfile beat a child's plain name because
`ConfigFile.discover` exhausts one resolver before starting the next, which
is the wrong precedence for a config-dir tool. The two-branch shape the
superseded Decision recorded is also rejected: it hard-coded exactly two
project-local filenames and offered no path to a third.

## Consequences

This repo's own config moves to `.config/okfit.toml`, the plugin workflow's
path filter narrows to that one file, and `init`'s target and refusal set
change — it now refuses when any of the three project-level names already
exists.
