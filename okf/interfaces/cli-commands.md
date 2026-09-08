---
type: Interface
title: okfit CLI — validate, init, context, verify
description: The okfit command line's four subcommands, their flags, exit codes, and JSON envelopes.
kind: cli
resource: ../../packages/cli/README.md
status: stable
generated:
  by: okfit/claude-code
tags:
  - architecture
---

# okfit CLI — validate, init, context, verify

## Subcommands and [path]

`okfit` has four subcommands: `validate`, `init`, `context`, `verify`. Each
takes an optional `[path]` as its first positional argument — the **project
root**, never the bundle root (`<project root>/<bundle.path>`, `okf` by
default) — defaulting to the current directory (the Subcommands and
[path] section of `packages/cli/README.md`). `verify` additionally takes a required
`<id>` before `[path]`.

## okfit validate

Loads the config, loads the bundle, runs conformance and lint checks against
it, then runs the resolved profile's own checks, and renders every
diagnostic. Each line is `<file>:<line>:<col> <severity> <code> <message>`
when the diagnostic carries a range, `<file> <severity> <code> <message>`
otherwise, and `(bundle)` in place of `<file>` for a bundle-level
diagnostic. Diagnostics sort by file (`(bundle)` first), then range-less
before ranged, then by offset, then by code. The summary line prints to
stderr (the `okfit validate` section of `packages/cli/README.md`).

## okfit init

Scaffolds a fresh bundle — config, `index.md`/`log.md`/`project.md` — then
self-validates the result and exits with `validate`'s own exit code, so a
scaffold that does not validate clean is treated as a defect. It never
overwrites: if any target path already exists, nothing is written and it
exits `3`. `--profile <name>` picks the profile to scaffold; an
unrecognised name is a warning, not a failure, and `init` continues with
the default profile (the `okfit init` section of `packages/cli/README.md`).

## okfit context

Prints the resolved project root, bundle root, config path, profile, and
vocabulary without loading the bundle. There is no `--profile` flag — that
one belongs to `init` alone. `context` never produces exit `1` or `2`: it
never runs conformance or lint checks (the `okfit context` section of
`packages/cli/README.md`).

## okfit verify

`okfit verify <id> [path] [--config <file>] [--at <iso>] [--dry-run]
[--format human|json]` appends one attestation, `{ by: human:<id>, at:
<now> }`, to a concept's `verified` list and writes the file back. `<id>` is
a concept id with or without a leading slash or trailing `.md`. The actor is
always your own git identity; there is no `--by`. Existing entries are never
touched or replaced — every run appends, including a repeat by the same
person. `--at <iso>` records a different instant; `--dry-run` prints what
would be written and writes nothing. Exit `0` on success (a dry run
included), `3` on any failure — an unknown or reserved id, a concept whose
`verified` shape cannot be edited safely, or an unresolved git identity;
there is no `1`/`2` content tier. This is a human-run command: no agent,
hook, or MCP tool ever invokes it.

## Config discovery

With no `--config` flag, `okfit` resolves config tier by tier: the project
tier checks each directory from `[path]` up to the filesystem root for
`.okfit.toml`, then `okfit.toml`, then `.config/okfit.toml`, and the first
file found anywhere wins; then the XDG tier
(`$XDG_CONFIG_HOME/okfit/config.toml`, `$XDG_CONFIG_DIRS`); then the native
tier (`~/.config/okfit/config.toml` or the platform-native directory); then
the system tier (`/etc/okfit/config.toml` on Linux and macOS, nothing on
Windows). `--config <file>` bypasses discovery entirely; a path that does
not exist is a hard failure, exit `3` (the Config discovery section of
`packages/cli/README.md`).

## Exit codes

| Code | Meaning |
| --- | --- |
| `130` | Interrupted (Ctrl-C) |
| `64` | Usage error |
| `3` | Infrastructure failure |
| `2` | One or more conformance errors |
| `1` | One or more lint or profile errors |
| `0` | Otherwise |

Higher wins when several apply; warnings and info never change the exit
code (`packages/cli/README.md:171-186`).

## JSON envelopes

`okfit validate --format json` prints `JsonEnvelope` (schema 1): `schema`,
`okfit_version`, `okf_version`, `root`, `profile`, `exit_code`, `summary`,
`diagnostics`. `okfit context --format json` prints a distinct
`ContextEnvelope` (schema 1) where every field is present even when
`null` — `config_path`, `profile`, `profile_requested`, and `actors.agent`
never an omitted key (`packages/cli/README.md:188-277`). `okfit verify
--format json` prints a distinct `VerifyEnvelope` with `schema`,
`okfit_version`, `id`, `path`, `verified`, `dry_run`, `exit_code`.

## Message conventions

Every message is lowercase, starts `error:` or `warning:`, never ends with
a trailing period, and renders a path relative to the current directory
when the path falls under it, absolute otherwise
(`packages/cli/README.md:279-285`).
