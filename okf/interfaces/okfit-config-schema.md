---
type: Interface
title: okfit config file schema
description: The .config/okfit.toml schema, its discovery order, and the defaults every key falls back to when unset.
kind: config
resource: ../../packages/core/src/OkfitConfig.ts
status: stable
generated:
  by: okfit/claude-code
  at: 2026-09-15T20:55:17Z
  body_sha256: 1e748c9b3e022a30bdcdce1c19fb3a0cd4b4a7b2c58f483313aaf546def92513
tags:
  - architecture
---

# okfit config file schema

## Discovery order

An explicit `--config <path>` is statted before any layer is built and, if
present, is the only source — no upward walk, no XDG probe. Otherwise
discovery proceeds tier by tier:

1. **Project** — each directory from the discovery start up to the
   filesystem root is checked for `.okfit.toml`, then `okfit.toml`, then
   `.config/okfit.toml`; the first file found anywhere wins. This walk
   reaches `$HOME`, so a `~/.config/okfit.toml` (or `~/okfit.toml`,
   `~/.okfit.toml`) is itself a project-tier file: it shadows the user
   tier below and anchors every project directory beneath `$HOME` to it.
2. **XDG** — `$XDG_CONFIG_HOME/okfit/config.toml` and `$XDG_CONFIG_DIRS`.
3. **Native** — `~/.config/okfit/config.toml`, or the platform-native
   directory: `~/Library/Application Support/okfit/config.toml` on macOS,
   `%APPDATA%\okfit\config.toml` on Windows.
4. **System** — `/etc/okfit/config.toml` on Linux and macOS; nothing on
   Windows.

| Winning source | Anchor |
| --- | --- |
| `<dir>/.okfit.toml` or `<dir>/okfit.toml` | `<dir>` |
| `<dir>/.config/okfit.toml` | `<dir>` (parent of `.config`) |
| `--config <p>` where `basename(dirname(p)) === ".config"` (any file name) | `dirname(dirname(p))` |
| `--config <p>`, any other shape | `dirname(p)` |
| resolver `"xdg"`, `"native"`, `"system"` | `cwd` |
| nothing found | `cwd` |

## Schema shape

`OkfitConfig` is a `Schema.Struct` with every key `Schema.optionalKey`
except `extensions`; config can only tighten what the spec requires, never
loosen it (`packages/core/CLAUDE.md:32`).

## Defaults

The `DEFAULTS` literal: `okf_version: "0.2"`; `bundle: { path: "okf",
profile: "software-project" }`; `concepts: { required: [], tags: {
required: [] } }`; `lifecycle: { default_stale_after: Duration.days(90) }`
(written `"90d"` in TOML); `actors: { humans: [] }`; `types`, `tags`, and
`extensions` all start empty, before a profile merges its own vocabulary
in.

## Lint severities

The nineteen default lint codes: `broken_links`, `missing_index`,
`footnote_source_unknown`, `footnote_undefined`, `log_frontmatter`, `config_unknown_key`,
`walk_unreadable`, `generated_at_drift`, and `source_resource_missing` default `warn`;
`unknown_type`, `required_key_missing`, `field_value_unknown`, `require_verified_unmet`,
`family_invalid`, and `computation_runtime_missing` default `error`;
`actor_prefix_unknown`, `legacy_timestamp`, and `stale` default `info`;
`status_missing` defaults `off`, because the spec reads an absent `status`
as `stable` and core keeps no opinion about it -- the software-project
profile is the layer that raises it to `warn` (issue #110), the one lint
severity that profile sets. `source_resource_missing` (issue #106) is the
one lint core cannot run itself: a `resource` or `sources[].resource` path
that resolves to nothing in the bundle is a descriptor to core (D-24), so
`@okfit/engine` resolves it on disk in D-23 order and reports the miss.
`broken_links` also checks a `#fragment` against the target concept's
heading slugs (issue #69).
`generated_at_drift` moved from `info` to `warn` when it gained a
content-comparison tier — see [A body digest inside generated detects real
drift, not a rewritten date](../decisions/profiles-body-sha256-detects-real-drift.md).

## Unknown keys go to extensions

An unrecognised top-level TOML key decodes into `extensions` and produces
lint `config-unknown-key` at its default severity `warn`, never an error —
config only ever tightens the spec (`packages/core/CLAUDE.md:32`).

## Published JSON Schema

okfit hosts a SchemaStore-compatible Draft-07 document at
`schemas/1.0/config.json`, generated from `okfitConfigDocumentFields`
(`@okfit/core`) by `packages/engine/lib/configs/schemastore.config.ts` via
`@effected/schemastore` and `@effected/schemastore-cli` (`pnpm schema:build` /
`pnpm schema:check`, the latter the CI drift gate). Its `$id` is
`https://raw.githubusercontent.com/spencerbeggs/okfit/main/schemas/1.0/config.json`
— the same identity `okfitConfigSchemaHost` (`@okfit/engine`, next to `init`)
derives, so the `#:schema` directive `okfit init` writes and the document
this build generates can never disagree. Versions are `major.minor`: this document is
`published: false` (not yet catalogued with SchemaStore), so a contract
change still rewrites `1.0` in place; once catalogued, changing the contract
appends a new label (`1.1`) instead of editing `1.0`, which then freezes.
SchemaStore would catalogue it under the name `config`, matching
`okfit.toml`, `.okfit.toml` and `**/.config/okfit.toml`; user- and
system-level files are not catalogued and should carry a `#:schema`
directive instead. Unknown top-level keys are permitted by the document,
matching the runtime's D-31 tolerance; every declared table is closed —
`@effected/schemastore` closes generated objects by default, so no
`jsonSchema.onExcessProperty` override is needed.
