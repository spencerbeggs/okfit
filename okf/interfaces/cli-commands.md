---
type: Interface
title: okfit CLI — validate, init, context, verify, sync, lint, graph, stale
description: The okfit command line's subcommands, their flags, exit codes, and JSON envelopes.
kind: cli
resource: ../../packages/cli/README.md
status: stable
generated:
  by: okfit/claude-code
  at: 2026-09-22T20:14:00Z
  body_sha256: 20a7ef57f14697d04a0ebff44beb26f9d2bcc60c28aeb6e20dfd3c48445c56f8
tags:
  - architecture
verified:
  - by: human:spencer
    at: 2026-09-24T00:18:10.948Z
---

# okfit CLI — validate, init, context, verify, sync, lint, graph, stale

## Subcommands and [path]

`okfit` has eight subcommands: `validate`, `init`, `context`, `verify`,
`sync`, `lint`, `graph`, `stale`. Each
takes an optional `[path]` as its first positional argument — the **project
root**, never the bundle root (`<project root>/<bundle.path>`, `okf` by
default) — defaulting to the current directory (the Subcommands and
[path] section of `packages/cli/README.md`). `verify` additionally takes an
optional `<id>` before `[path]`, required unless `--all` and/or `--type` is
given instead.

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

`--document <bundle-path>` validates one unsaved document: its text is
read from stdin and stands in for that file (bundle-relative, posix, a
`.md` path; a file not yet written under an existing directory is walked
like any other), and nothing is written. A path that is absolute, escapes
the bundle, is not `.md`, or sits under a directory that does not exist,
and a terminal stdin, are usage errors (exit `64`). The MCP
`validate_bundle` tool's `documents` input is the same overlay.

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

`okfit verify [<id>] [path] [--all] [--type <Type>]... [--config <file>]
[--at <iso>] [--dry-run] [--format human|json]` appends one attestation, `{
by: human:<id>, at: <now> }`, to a concept's `verified` list and writes the
file back. `<id>` is a concept id with or without a leading slash or
trailing `.md`. The actor is always your own git identity; there is no
`--by`. Existing entries are never touched or replaced — every run appends,
including a repeat by the same person. `--at <iso>` records a different
instant; `--dry-run` prints what would be written and writes nothing.
`--all` attests every concept whose type sets `require_verified` and that
carries no entry by you; `--type <Type>` (repeatable) narrows or replaces
that selection; `status: draft` concepts and ones you already verified are
reported as skipped. The dry run prints one fragment per concept in write
order so the set can be confirmed before anything is spliced; a single
unsupported `verified` shape fails the whole batch with nothing written.
Exactly one of `<id>` or `--all`/`--type` must be given; otherwise, or for an
undeclared type, exit `64`. `--format json` prints a `VerifyBatchEnvelope`
(`verified_by`, `verified_at`, `concepts`, `skipped`). Exit `0` on success (a
dry run included), `3` on any failure — an unknown or reserved id, a concept
whose `verified` shape cannot be edited safely, or an unresolved git
identity; there is no `1`/`2` content tier. This is a human-run command: no
agent, hook, or MCP tool ever invokes it.

## okfit sync

`okfit sync [path] [--config <file>] [--only <mode>]... [--dry-run]
[--format human|json] [--since <YYYY-MM-DD>] [--staged]` is the one command that regenerates every
derived-content family: `generated.at` and `generated.body_sha256` (per
concept, the digest always accompanying the date), `index.md` (every
directory that holds a concept, whether or not the profile layout names
it -- a custom type's directory is indexed the same way), and `log.md` (the root log, curated prose
topped up by date). It runs all three modes, generated then index then
log, in that fixed order, unless one or more `--only` flags narrow it to a
subset. `--dry-run` computes every result and writes nothing. Log mode
considers every committed concept dated on or after the newest logged
date, appending into that day's group unless it already names the concept
(see [the log decision](../decisions/cli-sync-log-appends-into-the-day.md));
`--since` replaces that floor. A malformed `--since` is a usage error,
exit `64`. `sync --only
generated` no longer rewrites an authoritative `generated.at`: when a
concept's recorded `body_sha256` still matches its current body, the
concept is reported `unchanged` and neither key is touched, even though a
fresh git walk would compute a different `at` — see [A body digest inside
generated detects real drift, not a rewritten
date](../decisions/profiles-body-sha256-detects-real-drift.md). It never
touches `verified` and takes no clock — the same `now`-as-argument
discipline as the rest of core. Exit `0` whether or not anything was
written, `3` on any typed failure, `64` on an unknown `--only` mode or a
malformed `--since`; there is no `1`/`2` content tier, since `sync` never
runs conformance or lint checks.

`--staged` is the pre-commit shape: only concepts in the git index are
considered, stamped with `now` and re-added; default modes become
`generated` and `index`, and `--only log` with `--staged` is a usage
error, exit `64` ([decision](../decisions/cli-sync-staged-stamps-now.md)).
Index mode under `--staged` still renders `index.md` from the working
tree, not the index, so an unstaged or untracked concept already on disk
is listed in the committed index before the concept itself is committed;
the next commit reconciles it.

`okfit sync --format json` prints a `SyncEnvelope` (schema 1): `schema`,
`okfit_version`, `engine_version`, `distribution`, `root`, `dry_run`,
`exit_code`, `generated`, `index`, `log` — each of the latter three an
object with `selected`, `written`, `unchanged`, `skipped`.

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
`okfit_version`, `engine_version`, `producer`, `distribution`,
`okf_version`, `root`, `profile`, `summary` (`nodes`, `edges`), `nodes` (`id`, `kind`: `concept` | `file` | `missing`),
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
`okfit_version`, `engine_version`, `producer`, `distribution`,
`okf_version`, `root`, `profile`, `as_of` (an ISO-8601 instant), `summary` (`concepts`, `stale`), `items` (`id`,
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
`okfit_version`, `engine_version`, `producer`, `distribution`,
`okf_version`, `root`, `profile`, `exit_code`, `summary`, `diagnostics`.

Four of those fields are about versions, and only two of them are worth
comparing. `engine_version` is the `@okfit/engine` that produced the
report and `okf_version` is the OKF spec version the bundle targets;
the engine stamps `engine_version` itself, so no front end can omit or
misreport it. `okfit_version` is the version of the front end that
produced the report and `producer` names it (`okfit` here, `@okfit/mcp`
from the MCP `validate_bundle` tool); the CLI and the MCP server version
independently and cannot know each other's version, so two reports over
one bundle legitimately differ there
([#75](https://github.com/spencerbeggs/okfit/issues/75),
[#137](https://github.com/spencerbeggs/okfit/issues/137)). `distribution`
is `{ "name", "version" }` for the meta-package the bin was installed
through (`@okfit/plugin`) and `null` for a direct install of `@okfit/cli`
or `@okfit/mcp`. The rule, from [The engine version, not the producer
version, is what a report is compared
on](../decisions/engine-version-is-the-comparable-version.md): compare
`engine_version` and `okf_version`; everything else is packaging.
`okfit --version` prints the same numbers in one line, plus the config
schema version — `okfit <cli> (engine <engine>, okf <okf>, config-schema
<schema>)`, with `via <distribution name> <version>` after the CLI
version when there is one.

`okfit context --format json` prints a distinct
`ContextEnvelope` (schema 1) where every field is present even when
`null` — `config_path`, `profile`, `profile_requested`, and `actors.agent`
never an omitted key (`packages/cli/README.md:188-277`) — and which
carries `config_schema_version`, core's `CONFIG_SCHEMA_VERSION`, the
`major.minor` label of the schema the loaded config was checked against
(`okf/interfaces/okfit-config-schema.md`). `okfit verify
--format json` prints a distinct `VerifyEnvelope` with `schema`,
`okfit_version`, `engine_version`, `distribution`, `id`, `path`,
`verified`, `dry_run`, `exit_code`. `okfit verify --all`/`--type
--format json` prints a distinct `VerifyBatchEnvelope` instead, with
`schema`, `okfit_version`, `engine_version`, `distribution`, `verified_by`,
`verified_at`, `concepts`, `skipped`, `dry_run`, `exit_code`.
`okfit lint --format json` reuses `JsonEnvelope` unchanged — same shape as
`okfit validate`'s — with `summary.conformance_errors` always `0` and no
`core.conformance`-sourced entry ever in `diagnostics`. `okfit graph
--format json` prints a distinct `GraphEnvelope` with `schema`,
`okfit_version`, `engine_version`, `producer`, `distribution`,
`okf_version`, `root`, `profile`, `summary` (`nodes`, `edges`), `nodes`,
`edges`. `okfit stale --format json` prints a distinct `StaleEnvelope`
with `schema`, `okfit_version`, `engine_version`, `producer`,
`distribution`, `okf_version`, `root`, `profile`, `as_of`, `summary`
(`concepts`, `stale`), `items`. An infrastructure failure under
`--format json` prints `JsonErrorEnvelope` — `schema`, `okfit_version`,
`engine_version`, `distribution`, `exit_code`, `error` — and nothing
else on stdout. `exit_code` is `3` for most errors, or `64` when the
underlying typed error is one of the usage-tier errors that carries its
own `[Runtime.errorExitCode]` (`SyncStagedLogError`, `VerifySelectionError`)
— it always matches the process's own exit code.

## Message conventions

Every message is lowercase, starts `error:` or `warning:`, never ends with
a trailing period, and renders a path relative to the current directory
when the path falls under it, absolute otherwise
(`packages/cli/README.md:279-285`).
