---
type: Decision
title: The engine version, not the producer version, is what a report is compared on
description: Every JSON envelope stamps engine_version from @okfit/engine itself and carries the meta-package it was installed through as distribution, and core owns the config schema version, because okfit_version only ever named the producing front end and two front ends over one engine read as drift.
tags:
  - architecture
  - release
  - dx
status: stable
supersedes: engine-version-is-the-comparable-version.md
sources:
  - id: okfit-137
    resource: https://github.com/spencerbeggs/okfit/issues/137
    author: process:okfit-migrate
  - id: okfit-75
    resource: https://github.com/spencerbeggs/okfit/issues/75
  - id: owner-ruling
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-09-16T00:00:00Z
  - id: version-formatter
    resource: ../../packages/cli/src/internal/versionFormatter.ts
generated:
  by: okfit/claude-code
  at: 2026-09-24T16:07:02Z
  body_sha256: 874fd08c90f163131148eb23c1dd0b7b71167e58c60f9887cdef1cf90b5fc8ba
verified:
  - by: human:spencer
    at: 2026-09-24T16:07:36Z
---

# The engine version, not the producer version, is what a report is compared on

## Context

okfit ships as six independently versioned things: the `okfit` CLI
(`@okfit/cli`), the MCP server (`@okfit/mcp`), the meta-package that
installs both bins (`@okfit/plugin`), the shared `@okfit/engine` that the
CLI and the MCP server both run, the OKF spec version the whole project
targets, fixed at `0.2`, and the `major.minor` version of the config
file's JSON Schema, `1.0`. The CLI and the MCP server cannot know
each other's version — the dependency graph is acyclic and neither
depends on the other — but they share the engine, and it is the engine
that decides what a report says.

Issue 75 settled that the JSON envelope's `okfit_version` names the
*producing* package and added `producer` so a reader would see two
producers rather than drift.[^okfit-75] Issue 137 is the exact reading
that ruling was meant to prevent: an agent migrating another repository
compared `okfit validate --format json` (`okfit_version: 0.5.4`) with
the MCP `validate_bundle` tool (`okfit_version: 0.3.7`) over one bundle
and concluded they had run different engines.[^okfit-137] Both had run
`@okfit/engine 0.6.0`, which neither report named, because the engine
had no version constant of its own.

The config schema had the mirror-image problem: its shape is
`@okfit/core`'s `okfitConfigDocumentFields`, but the `1.0` label, the
hosted `$id`, the `#:schema` directive and the schemastore build that
publishes the document all lived in `@okfit/engine`, one package away
from the struct they describe, because `okfit init` — an engine program
— happened to be their first consumer.[^owner-ruling]

## Decision

The versions that matter to a reader are the engine version, the OKF
version, and the config schema version; every other number is
packaging.[^owner-ruling]

- `@okfit/engine` exports `ENGINE_VERSION`, injected at build time from
  its own `package.json` exactly as `CLI_VERSION` and `MCP_VERSION` are.
- Every JSON envelope the engine renders (`JsonEnvelope`,
  `JsonErrorEnvelope`, `GraphEnvelope`, `StaleEnvelope`, `SyncEnvelope`,
  `VerifyEnvelope`) carries `engine_version`. The engine's renderers
  stamp it themselves; no front end passes it in, so no front end can
  omit or misreport it. Together with the existing `okf_version` this is
  the pair a reader compares.
- The same envelopes carry `distribution`: `{ name, version }` naming the
  meta-package the bin was installed through, or `null` for a direct
  install of `@okfit/cli` or `@okfit/mcp`. Both packages' `main()` take
  an optional `{ distribution }` argument, and `@okfit/plugin`'s two bins
  pass their own package name and version through it. The absence of a
  distribution is itself the signal that the front end was installed
  directly.
- `@okfit/core` owns the config schema whole: `CONFIG_SCHEMA_VERSION`,
  the `major.minor` label of the JSON Schema that
  `okfitConfigDocumentFields` describes; `okfitConfigSchemaHost`, the
  hosted identity whose `versions` derive from that label; the
  `SCHEMA_DIRECTIVE` string a config file opens with; and the schemastore
  build (`packages/core/lib/configs/schemastore.config.ts`,
  `pnpm schema:build` / `schema:check`) that publishes the document.
  Engine's `init` consumes the directive the way `--version` consumes
  `ENGINE_VERSION`. Core owns all of it because core owns the shape: an
  additive optional key is a minor bump, a removed or retyped key a major
  one, and `pnpm schema:check` refuses a published document that no
  longer matches the struct. Profiles get
  no schema version of their own: core cannot see them, a profile
  contributes values (types, tags, severities) rather than shape, and a
  profile that ever needed a config key would add it to core's struct.
  The `okfit context --format json` envelope carries it as
  `config_schema_version`; the other envelopes do not, since it is a
  fact about the config rather than about a report.
- `okfit_version` and `producer` keep their issue-75 meaning — the
  producing front end and its version — and `schema` stays `1`; the
  change is additive.
- `okfit --version` prints all four, and the distribution when there is
  one: `okfit 0.5.4 (engine 0.6.0, okf 0.2, config-schema 1.0)` from a
  direct install, `okfit 0.5.4 via @okfit/plugin 0.3.7 (engine 0.6.0,
  okf 0.2, config-schema 1.0)` from the meta-package. The label is
  `config-schema`, not `config-file`, because the TOML directive, the
  `schemas/1.0/` tree and the JSON field all say "schema", and
  `config-file 1.0` reads as the version of the reader's own file. The MCP server's `initialize` response keeps
  reporting `MCP_VERSION`, because that field's protocol meaning is the
  server's own version.

## Alternatives rejected

- **Rename `okfit_version` to `producer_version` and bump `schema` to
  `2`.** Cleaner names, but it breaks every consumer keyed on schema 1
  to fix a field that was never wrong about what it said, only about
  what readers assumed it meant. Naming the engine explicitly removes the
  assumption without the break.
- **Have the CLI and the MCP server report each other's version.** They
  cannot: neither depends on the other, and adding either edge would
  make the package graph cyclic.
- **A separate `okfit version` subcommand with `--format json`.** Every
  `--format json` envelope already carries the triple, so a dedicated
  probe only adds surface; `--version` is overridden instead, through
  [`internal/versionFormatter.ts`](../../packages/cli/src/internal/versionFormatter.ts),
  built on `@effected/cli`'s `CliColor.formatterLayer` and reading
  `@effected/engine`'s `CurrentDistribution`[^version-formatter] — the
  mechanism that replaced this package's original hand-rolled
  `CliOutput.Formatter` override
  ([front-ends-adopt-the-effected-kit](front-ends-adopt-the-effected-kit.md)).
- **Leave the schema identity and build in `@okfit/engine`, next to
  `init`.** Rejected: `init` merely writes the directive, and splitting
  shape from identity across two packages is what let the version label
  drift into a restated literal in the first place.
- **Give `@okfit/profiles` its own schema version.** Rejected above: a
  profile changes vocabulary, which `profile` already names in every
  envelope and the profiles package version already tracks.
- **Thread the Claude Code plugin's own version through
  `start-mcp.sh` as a second distribution layer.** Deferred; nothing
  reads it yet.

## Consequences

- Skills and issue templates that record "the okfit version" record the
  engine, OKF, and config schema versions, and name the distribution
  when there is one;
  the CLI, MCP, and meta-package versions are noted as packaging, not as
  the thing being compared.
- A reader comparing a CLI report with an MCP report over one bundle
  now sees the same `engine_version` and `okf_version` and different
  `producer` values, which is the reading issue 75 intended.
- `@okfit/plugin` gains a build-time `PLUGIN_VERSION` and a real
  behavioural test of its own: its bins must be seen passing the
  distribution through, not merely re-exporting `main`.

[^okfit-75]: <https://github.com/spencerbeggs/okfit/issues/75>
[^okfit-137]: <https://github.com/spencerbeggs/okfit/issues/137>
[^owner-ruling]: conversation with the repository owner, 2026-09-16
[^version-formatter]: ../../packages/cli/src/internal/versionFormatter.ts
