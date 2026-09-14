---
type: Interface
title: okfit CLI — validate, init, context, verify, sync, lint, graph, stale
description: The okfit command line's subcommands, their flags, exit codes, and JSON envelopes.
kind: cli
resource: ../../packages/cli/README.md
status: stable
generated:
  by: okfit/claude-code
  at: 2026-09-14T18:18:28Z
  body_sha256: 2c53791f02205130e59d5a313b9ae2c7372c82884d7143b221701f214e9eec07
tags:
  - architecture
---

# okfit CLI — validate, init, context, verify, sync, lint, graph, stale

## Subcommands and [path]

`okfit` has eight subcommands: `validate`, `init`, `context`, `verify`,
`sync`, `lint`, `graph`, `stale`. Each
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
`--skip-provenance` skips only the fallback, git-derived tier of
`generated-at-drift` — the comparison used for a concept with no recorded
`generated.body_sha256` — for that invocation, without changing the
project's `[lint]` table; a concept carrying a digest is still checked by
pure content comparison, since that tier makes no git call. The
PostToolUse hook passes it so an edit-time validate stays git-free for any
un-migrated concept, while CI and the MCP `validate_bundle` tool keep the
git tier too (ruling S-31). See [A body digest inside generated detects
real drift, not a rewritten date](../decisions/profiles-body-sha256-detects-real-drift.md).

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

## okfit sync

`okfit sync [path] [--config <file>] [--only <mode>]... [--dry-run]
[--format human|json]` is the one command that regenerates every
derived-content family: `generated.at` and `generated.body_sha256` (per
concept, the digest always accompanying the date), `index.md` (every
directory that holds a concept, whether or not the profile layout names
it -- a custom type's directory is indexed the same way), and `log.md` (the root log, curated prose
topped up by date). It runs all three modes, generated then index then
log, in that fixed order, unless one or more `--only` flags narrow it to a
subset. `--dry-run` computes every result and writes nothing. `sync --only
generated` no longer rewrites an authoritative `generated.at`: when a
concept's recorded `body_sha256` still matches its current body, the
concept is reported `unchanged` and neither key is touched, even though a
fresh git walk would compute a different `at` — see [A body digest inside
generated detects real drift, not a rewritten
date](../decisions/profiles-body-sha256-detects-real-drift.md). It never
touches `verified` and takes no clock — the same `now`-as-argument
discipline as the rest of core. Exit `0` whether or not anything was
written, `3` on any typed failure, `64` on an unknown `--only` mode; there
is no `1`/`2` content tier, since `sync` never runs conformance or lint
checks.

`okfit sync --format json` prints a `SyncEnvelope` (schema 1): `schema`,
`okfit_version`, `root`, `dry_run`, `exit_code`, `generated`, `index`,
`log` — each of the latter three an object with `selected`, `written`,
`unchanged`, `skipped`.

## okfit lint

`okfit lint [path] [--config <file>] [--format human|json]
[--skip-provenance]` shares `validate`'s whole handler — the same config
resolution, the same engine `run` call (both tiers `Validate.all` produces
still run internally, and `--skip-provenance` still means exactly what it
means for `validate`), the same human and JSON renderers — except the
CONFORMANCE tier is dropped from what it collects and reports. Only lint
and profile diagnostics ever appear on its stdout; `summary.conformance_errors`
in its JSON envelope is always `0`. Exit `1` on a lint or profile error,
`0` otherwise — never `2`, since conformance never surfaces here. A bundle
that fails only on conformance (frontmatter parsing, a missing required
key at the OKF spec level) reports clean under `lint`, even though `okfit
validate` would exit `2` against it.

## okfit graph

`okfit graph [path] [--config <file>] [--format mermaid|dot|json]` loads
the bundle and renders its link graph — frontmatter path fields and body
links, both concept-to-concept and concept-to-file, including dangling
links to a target that does not exist (D-25). `--format` defaults to
`mermaid`, unlike every other command's `human` default: `mermaid` and
`dot` print the graph's own Mermaid flowchart or GraphViz DOT text raw to
stdout, with nothing else on stdout and no summary line, so either can be
piped straight into a renderer. Loading the bundle never fails on content
(D-9's "loading never fails on content" rule) — a bundle that would fail
`validate`'s conformance tier still graphs cleanly. Exit `0` always;
`graph` never runs conformance, lint, or profile checks.

`okfit graph --format json` prints a `GraphEnvelope` (schema 1): `schema`,
`okfit_version`, `producer`, `okf_version`, `root`, `profile`, `summary`
(`nodes`, `edges`), `nodes` (`id`, `kind`: `concept` | `file` | `missing`),
`edges` (`from`, `to`, `source`: `body` | `frontmatter`, an omitted `field`
key unless the edge came from a named frontmatter path field, `raw`).

## okfit stale

`okfit stale [path] [--config <file>] [--format human|json]` loads the
bundle and lists every concept whose `stale_after` instant has already
passed as of now, sorted by id, each with how many whole days past it.
`OKFIT_NOW` (K-47) substitutes for the wall clock the same way it does for
every other command. This is a report, not a check: exit is always `0`,
even when concepts are stale — the `stale` lint rule, part of `okfit
validate`/`okfit lint`, is where staleness can fail a run (at whatever
severity `[lint].stale` is configured). The human format prints one line
per stale concept, `<id>  <stale_after ISO>  (<N> days past)`, to stdout,
then a one-line summary, `<N> stale concepts of <M> in <root>`, to stderr.

`okfit stale --format json` prints a `StaleEnvelope` (schema 1): `schema`,
`okfit_version`, `producer`, `okf_version`, `root`, `profile`, `as_of` (an
ISO-8601 instant), `summary` (`concepts`, `stale`), `items` (`id`,
`stale_after`, `days_past`).

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
code (`packages/cli/README.md:171-186`). `okfit lint` uses this same
table minus the `2` row — it never runs the conformance tier, so its own
exit is always `0`, `1`, or one of the process-level codes above.
`okfit graph` and `okfit stale` are reports, not checks: both always exit
`0` except for the process-level codes above (`64`, `3`, `130`).

## JSON envelopes

`okfit validate --format json` prints `JsonEnvelope` (schema 1): `schema`,
`okfit_version`, `producer`, `okf_version`, `root`, `profile`,
`exit_code`, `summary`, `diagnostics`. `okfit_version` is the version of
the package that produced the report and `producer` names that package
(`okfit` here, `@okfit/mcp` from the MCP `validate_bundle` tool), so the
two reports over one bundle legitimately differ in `okfit_version`
([#75](https://github.com/spencerbeggs/okfit/issues/75)). `okfit context --format json` prints a distinct
`ContextEnvelope` (schema 1) where every field is present even when
`null` — `config_path`, `profile`, `profile_requested`, and `actors.agent`
never an omitted key (`packages/cli/README.md:188-277`). `okfit verify
--format json` prints a distinct `VerifyEnvelope` with `schema`,
`okfit_version`, `id`, `path`, `verified`, `dry_run`, `exit_code`.
`okfit lint --format json` reuses `JsonEnvelope` unchanged — same shape as
`okfit validate`'s — with `summary.conformance_errors` always `0` and no
`core.conformance`-sourced entry ever in `diagnostics`. `okfit graph
--format json` prints a distinct `GraphEnvelope` with `schema`,
`okfit_version`, `producer`, `okf_version`, `root`, `profile`, `summary`
(`nodes`, `edges`), `nodes`, `edges`. `okfit stale --format json` prints a
distinct `StaleEnvelope` with `schema`, `okfit_version`, `producer`,
`okf_version`, `root`, `profile`, `as_of`, `summary` (`concepts`,
`stale`), `items`.

## Message conventions

Every message is lowercase, starts `error:` or `warning:`, never ends with
a trailing period, and renders a path relative to the current directory
when the path falls under it, absolute otherwise
(`packages/cli/README.md:279-285`).
