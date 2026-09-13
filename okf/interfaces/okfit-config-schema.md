---
type: Interface
title: okfit config file schema
description: The .config/okfit.toml schema, its discovery order, and the defaults every key falls back to when unset.
kind: config
resource: ../../packages/core/src/OkfitConfig.ts
status: stable
generated:
  by: okfit/claude-code
  at: 2026-09-13T04:02:58Z
  body_sha256: d42e16d11c74154fafd9d82bee2e1a96afbc6cf09791df0fcdf5800562e900a4
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

The seventeen default lint codes: `broken_links`, `missing_index`,
`footnote_source_unknown`, `footnote_undefined`, `log_frontmatter`, `config_unknown_key`,
`walk_unreadable`, and `generated_at_drift` default `warn`; `unknown_type`,
`required_key_missing`, `field_value_unknown`, `require_verified_unmet`,
`family_invalid`, and `computation_runtime_missing` default `error`;
`actor_prefix_unknown`, `legacy_timestamp`, and `stale` default `info`.
`generated_at_drift` moved from `info` to `warn` when it gained a
content-comparison tier — see [A body digest inside generated detects real
drift, not a rewritten date](../decisions/profiles-body-sha256-detects-real-drift.md).

## Unknown keys go to extensions

An unrecognised top-level TOML key decodes into `extensions` and produces
lint `config-unknown-key` at its default severity `warn`, never an error —
config only ever tightens the spec (`packages/core/CLAUDE.md:32`).

## Published JSON Schema

okfit hosts a SchemaStore-compatible Draft-07 document at
`schemas/config/okfit-1.0.0.json`, generated from `OkfitConfig`'s field schema
by `pnpm generate-schema` and guarded against drift by
`__test__/generate-schema.test.ts`. Its `$id` is
`https://raw.githubusercontent.com/spencerbeggs/okfit/main/schemas/config/okfit-1.0.0.json`.
Versions are MAJOR-only above `1.0.0`: any change to an assertion bumps the
major and writes a new file, leaving the published one intact; a change before
the schema is ever catalogued rewrites `1.0.0` in place. SchemaStore catalogues
it under the name `okfit`, matching `okfit.toml`, `.okfit.toml` and
`**/.config/okfit.toml`; user- and system-level files are not catalogued and
should carry a `#:schema` directive instead. Unknown top-level keys are
permitted by the document, matching the runtime's D-31 tolerance; every
declared table is closed. Since `effect@4.0.0-rc.113` the generator leaves
structs open by default, so the target passes `jsonSchema.onExcessProperty =
"error"` explicitly; the core test `OkfitConfigDocument.test.ts` proves the
same option closes them.
