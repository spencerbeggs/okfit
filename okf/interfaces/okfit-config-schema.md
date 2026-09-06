---
type: Interface
title: okfit config file schema
description: The .config/okfit/config.toml schema, its discovery order, and the defaults every key falls back to when unset.
kind: config
resource: ../../packages/core/src/OkfitConfig.ts
status: stable
generated:
  by: human:spencer
tags:
  - architecture
---

# okfit config file schema

## Discovery order

An explicit `--config <path>` is statted before any layer is built and, if
present, is the only source — no upward walk, no XDG probe. Otherwise
`okfit` walks upward from the project root looking first for
`.config/okfit/config.toml`, then `okfit.config.toml`, then falls back to
the XDG pair, landing personal defaults at
`$XDG_CONFIG_HOME/okfit/config.toml`. The project root anchors on whichever
project-local file was found (`packages/cli/README.md:146-155`,
`packages/cli/CLAUDE.md:12-25`).

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

The fifteen default lint codes: `broken_links`, `missing_index`,
`footnote_source_unknown`, `log_frontmatter`, `config_unknown_key`, and
`walk_unreadable` default `warn`; `unknown_type`, `required_key_missing`,
`field_value_unknown`, `require_verified_unmet`, `family_invalid`, and
`computation_runtime_missing` default `error`; `actor_prefix_unknown`,
`legacy_timestamp`, and `stale` default `info`.

## Unknown keys go to extensions

An unrecognised top-level TOML key decodes into `extensions` and produces
lint `config-unknown-key` at its default severity `warn`, never an error —
config only ever tightens the spec (`packages/core/CLAUDE.md:32`).
