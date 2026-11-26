---
type: Interface
title: okfit config file schema
description: The .config/okfit.toml schema, its discovery order, and the defaults every key falls back to when unset.
x-okfit-kind: config
resource: ../../packages/core/src/OkfitConfig.ts
status: stable
generated:
  by: okfit/claude-code
  at: 2026-11-26T05:28:06Z
tags:
  - architecture
verified:
  - by: human:spencer
    at: 2026-09-24T00:18:12.265Z
  - by: human:spencer
    at: 2026-10-11T15:55:11Z
  - by: human:spencer
    at: 2026-10-11T17:15:28Z
  - by: human:spencer
    at: 2026-10-11T22:01:13Z
  - by: human:spencer
    at: 2026-11-05T22:58:34Z
  - by: human:spencer
    at: 2026-11-23T22:13:15Z
  - by: human:spencer
    at: 2026-11-24T02:55:14Z
  - by: human:spencer
    at: 2026-11-24T06:53:02Z
  - by: human:spencer
    at: 2026-11-24T14:56:24Z
  - by: human:spencer
    at: 2026-11-24T22:21:07Z
  - by: human:spencer
    at: 2026-11-25T02:05:49Z
  - by: human:spencer
    at: 2026-11-25T13:30:01Z
  - by: human:spencer
    at: 2026-11-26T06:31:52Z
x-okfit-integrity:
  generated:
    body: 3c3e653d992f4593
  verified:
    by: human:spencer
    at: 2026-11-26T06:31:52Z
    content: 63eb334240cdd56e
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

The `DEFAULTS` literal has no `okf_version`: the key is the version `okfit
init` writes (and `okfit sync` writes into a root index that declares none),
and a bundle's own declaration decides how it is read. Leaving it out keeps a
change to the spec constant `OKF_SPEC_VERSION` (`"0.3"`) from silently moving
an undeclared bundle to v0.3 resolution; `init` falls back to the constant
when the config sets nothing. The rest: `bundle: { path: "okf",
profile: "software-project" }`; `concepts: { required: [], tags: {
required: [] } }`; `lifecycle: { default_stale_after: Duration.days(90) }`
(written `"90d"` in TOML); `actors: { humans: [] }` (`humans` is an array of `ActorPattern`: ids or `*`/`?` globs, never emails; a non-empty list is an allow-list for `okfit verify`); `types`, `tags`, and
`extensions` all start empty, before a profile merges its own vocabulary
in.

## `[bundle] non_concepts`

`non_concepts` is an optional list of globs, relative to the bundle root, of
the `.md` files allowed to have no frontmatter or no `type`. `DEFAULTS` has no
value for it, so core guards nothing by itself, and a glob that does not
compile, or whose `[` or `{` never closes, fails config decode (write `'\['`
in single quotes or `"\\["` in double quotes in TOML). The software-project profile sets it to
`**/README.md`, `**/AGENTS.md`, `**/CONTRIBUTING.md` and `**/SKILL.md`; an
empty list allows none. A listed file still draws `type_missing` or
`frontmatter_missing`. See [Markdown that is not a concept is skipped, not an
error](../decisions/non-concept-markdown-is-skipped.md).

A config that fails decode is reported as `malformed config <path>: <key>:
<reason>` (for example `lint.missing_index: Expected "off" | "info" | "warn" |
"error"`): it names every failing key (`bundle.non_concepts[0]` for a list entry) when it fails schema decode (a TOML syntax error keeps the parser's message) and its reason, one entry per key, separated by `;`, so one run lists all of them.

## Lint severities

The forty-three default lint codes (the twenty-nine below, the ten that OKF v0.3 support added, listed after them, `non_concept_unlisted`, and the three described after it): `broken_links`, `missing_index`,
`footnote_source_unknown`, `footnote_undefined`, `log_frontmatter`, `config_unknown_key`,
`walk_unreadable`, `generated_at_drift`, `source_resource_missing`, `generated_missing`,
`publication_drift`, `surface_unmatched`, `verified_before_change` and `verified_drift` default `warn`;
`resource_untracked` defaults `warn` and `resource_ignored` defaults `error` (issue #279;
see below); `unknown_type`, `required_key_missing` (a key written as null, `""` or `[]` is reported as "is empty", an unwritten one as "is missing"), `field_value_unknown` (an empty value is absent, not unknown), `require_verified_unmet` (no `verified` entry at all),
`family_invalid` (since OKF v0.3 support only okfit's own `x-okfit-integrity` family, named for the reason in [okfit's keys carry the x-okfit- prefix](../decisions/okfit-keys-carry-x-okfit-prefix.md); every other malformed family reads key by key and raises one of the warnings below instead), `computation_runtime_missing` (whenever the decoded `runtime` is absent, including a present but unreadable one), and `publication_orphan` default `error`;
`actor_prefix_unknown`, `legacy_timestamp`, and `stale` default `info`;
`actor_email` (an actor contains `@`) and `verified_actor_unknown` (a verifier matches no entry of a non-empty `[actors].humans`) default `warn`, as does `verified_drift` when the bound verifier has left the list;
The ten codes added for OKF v0.3 default `warn`, except `resource_outside_project`, which is `info`: `index_metadata_invalid` (the root `index.md` carries an `okf_version` that is not a quoted `<major>.<minor>` string, or a non-string `title`, `description` or `license`), `entry_ignored` (a `sources`, `verified`, `generated` or `parameters` entry lacks a required key or has one okfit cannot read, so the entry is ignored), `value_malformed` (a defined value cannot be read in its shape and is read as absent; a malformed `stale_after` reads as `malformed`), `value_unknown` (a `status` outside `draft`, `stable` and `deprecated` is kept and the concept is not read as current knowledge), `frontmatter_missing` and `type_missing` (the `.md` file is not a concept and is skipped; they were conformance errors in OKF v0.2), and `symlink_escape` (a bundle file or directory is a symbolic link out of the bundle root, or one that cannot be resolved (dangling, a loop, an unreadable target), and is not read or walked). The other three are `resource_outside_project` (default `info`, described below), `superseded_by_orphan` (a concept carries `superseded_by` but its status is not `deprecated`) and `superseded_by_unresolved` (a deprecated concept's `superseded_by` resolves to an asset, an external value or the concept itself; a missing target stays `broken_links`). `actor_prefix_unknown` accepts `team:` and also checks `sources[].author`. The config schema label stays `1.0`; the keys are additive and the document has not been catalogued.
`non_concept_unlisted` (default `warn`) is an okfit opinion, not OKF conformance (§3.2 allows such files): it reports a `.md` file that `frontmatter_missing` or `type_missing` skipped and that no glob of `[bundle] non_concepts` matches. It is silent while `non_concepts` is absent.
`computation_missing` (default `warn`) reports an Attested Computation concept with no computation: no `computation` value (an empty or null `computation:` counts as absent) and no computation in the body under the bundle's declared reading (under 0.3 a fenced block in the `Computation` section at any heading level; under 0.2 a non-empty depth-one `Computation` section). `config_okf_version_stale` (default `warn`, bundle-level) fires when the config sets `okf_version` and the root index declares a different one, compared as versions when both parse and as strings otherwise; its message names the config file that sets `okf_version`, or says "the config" when no file is known, and when the root index's version does not parse it asks to correct `index.md` instead of offering that value (#499), and `--fix` never edits the config. `generated_at_future` (default `warn`) fires on a concept whose `generated.at` is more than five minutes later than now, because no verification can count against it (OKF 0.3 §5.3) and a single `okfit verify <id>` refuses it (a selection skips it); the message says `okfit sync` re-stamps it, or, when a verification dated between now and the stamp would then count, that sync will not and a human must correct `generated.at` or that verification.
`status_missing` defaults `off`, because the spec reads an absent `status`
as `stable` and core keeps no opinion about it -- the software-project
profile is the layer that raises it to `warn` (issue #110), the one lint
severity that profile sets. `source_resource_missing` (issue #106) is the
one lint core cannot run itself: a `resource` or `sources[].resource` path
that resolves to nothing in the bundle is a descriptor to core (D-24), so
`@okfit/engine` resolves it on disk in D-23 order and reports the miss.
`resource_outside_project` is okfit's repository check, not OKF's: a
`resource` value that resolves outside the project root, directly or through
a symlink, is reported without okfit reading, statting or passing the target to git (it
may resolve a link's real path to decide containment); see [Repository resources are classified by where they
resolve](../decisions/repository-resources.md).
`resource_ignored` and `resource_untracked` (issue #279) cover the same literal
values when the file exists locally but other checkouts would not have it: the
first for a gitignored file, the second for a file git does not track yet (not
raised once it is staged). Both are git-backed, skip a bundle outside a git
repository, and are skipped by `--skip-provenance` and the language server; see
[A cited file that other checkouts cannot see is a lint, split by whether it is
ignored](../decisions/untracked-resources.md).
`broken_links` also checks a `#fragment` against the target concept's
heading slugs (issue #69), which follow `github-slugger` ([Heading anchors
match github-slugger](../decisions/heading-slugs.md)).
`generated_at_drift` moved from `info` to `warn` when it gained a
content-comparison tier — see [Every okfit digest lives in one integrity
family](../decisions/integrity-family.md).
`verified_before_change` (core) fires when a concept has `verified` entries
but the ones at or after `generated.at` give a lower trust tier than all of
them would (OKF v0.3 §5.3, "verified before the last change"); draft,
deprecated and unknown-status concepts are exempt. `verified_drift` does not
repeat it. `verified_drift` fires when a human `verified` entry no longer covers the
concept's content: no binding (`unbound`), changed content, or a later
unbound entry. Draft and deprecated concepts are exempt (`okfit verify`
refuses them), though their signal still reads drifted. Raise it to `error` to gate on
it, or set `off` to skip the hashing. This repository's own `.config/okfit.toml` leaves it at `warn` — see [Verification drift is a
signal to weigh, never a gate](../decisions/drift-is-a-signal.md).
`generated_missing` (issue #73) fires only when `actors.agent` is set: a
concept with no `generated` block would otherwise only surface as a skip in
`okfit sync`'s post-commit report, after the commit already landed. A
`generated` written as null, `""` or `[]` counts as no block.
The three docs-surface lints are named in core but run in `@okfit/profiles` (`publication_*`) and `@okfit/engine` (`surface_unmatched`). The `publication_*` severities only take effect under the `software-project` profile; under any other profile those lints do not run.

## Unknown keys go to extensions

An unrecognised top-level TOML key decodes into `extensions` and produces
lint `config-unknown-key` at its default severity `warn`, never an error —
config only ever tightens the spec (`packages/core/CLAUDE.md:32`).

## Published JSON Schema

okfit hosts a SchemaStore-compatible Draft-07 document at
`schemas/1.0/config.json`, generated from `okfitConfigDocumentFields`
(`@okfit/core`) by `packages/core/lib/configs/schemastore.config.ts` via
`@effected/schemastore` and `effected schema` (`pnpm schema:build` /
`pnpm schema:check`, the latter the CI drift gate). Its `$id` is
`https://raw.githubusercontent.com/spencerbeggs/okfit/main/schemas/1.0/config.json`
— the same identity `okfitConfigSchemaHost` (`@okfit/core`, beside the
struct) derives, so the `#:schema` directive `okfit init` writes
(`SCHEMA_DIRECTIVE`, also core's) and the document this build generates can
never disagree. The version label itself is `CONFIG_SCHEMA_VERSION` in
`@okfit/core`; `okfitConfigSchemaHost` derives its `versions` from it, `okfit context
--format json` reports it as `config_schema_version`, and `okfit --version`
prints it as `config-schema <label>` ([The engine version, not the
producer version, is what a report is compared
on](../decisions/comparable-version.md)). Versions
are `major.minor` — an additive optional key is a minor bump, a removed or
retyped key a major one: this document is
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
