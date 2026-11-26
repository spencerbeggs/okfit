---
type: Module
title: Core
description: The no-internal-deps base package -- OKF frontmatter schemas, bundle loading, the link graph, derivation, and validation, with no opinions about bundle content.
status: stable
resource: ../../packages/core
x-okfit-kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-11-26T06:24:20Z
x-okfit-integrity:
  generated:
    body: d43a67fb462a6ed6
---

# Core

## Purpose

`@okfit/core` is the no-internal-deps base package; every other `@okfit/*`
package depends on it (`packages/core/CLAUDE.md:1-5`). It owns OKF
frontmatter schemas, bundle loading, the link graph, derivation (trust tier,
staleness, index and log rendering), and conformance validation.

## Rules and boundaries

- No Node-only imports: platform services (`FileSystem`, `Path`) come from
  the environment, so the same code runs in a CLI, in tests with
  `@effected/memfs`, and in a GitHub Action.
- Time is an explicit `now` argument, never a `Clock` dependency (D-10).
- No opinions beyond the spec: anything that says what a bundle *should*
  contain belongs in `@okfit/profiles` or a config file.
- Loading never fails on content -- bad files become diagnostics, not errors.

## Layout

`src/index.ts` is the public barrel and never exports from `internal/`. The
per-family schema files -- `Actor.ts` (with `ActorPattern` and the `Actor.matches`/`allowed`/`isPattern` allow-list helpers), `Timestamp.ts`, `Source.ts`,
`Generated.ts`, `Verification.ts`, `Status.ts`, `AttestedComputation.ts` --
sit alongside `Concept.ts`, `Bundle.ts`, `Graph.ts`, `Derive.ts`, and
`Validate.ts`. `OkfitConfig.ts` holds the spec 4.2 struct, `DEFAULTS`,
`merge`, `severityFor`, `read`, the `OkfitConfigFile` tag, and the whole
config JSON Schema contract -- `okfitConfigDocumentFields`,
`CONFIG_SCHEMA_VERSION`, `okfitConfigSchemaHost`, `SCHEMA_DIRECTIVE` --
which `lib/configs/schemastore.config.ts` publishes to the repo-root
`schemas/` tree via `pnpm schema:build` / `schema:check` (see [The engine
version, not the producer version, is what a report is compared
on](../decisions/comparable-version.md)).
`internal/` is the engine: `position`, `fence`, `walk`, `frontmatter`,
`reserved`, `links`, `lintRules`, `templates`
(`packages/core/CLAUDE.md:17-26`). Posix path arithmetic is `@effected/walker`'s
`PosixPath`, which never reads the working directory; actor allow-list
matching is `@effected/glob`'s `Wildcard`; the fence state and the value
offset are `@effected/markdown`'s `FrontmatterSource.split`, held to the `---`
fence; and `footnote-undefined` reads the parser's
`unresolvedFootnoteReferences`.

`internal/walk.ts` is now a thin adapter over `@effected/walker`'s
`descend(pattern, { onUnreadable: "record" })` rather than a hand-rolled
recursion (`packages/core/src/internal/walk.ts:52-78`): unreadable
subdirectories still become sorted `walk-unreadable` diagnostics, and an
unreadable root is re-read once to surface the real `PlatformError` as
`BundleReadError`. A walk that descends past `maxDepth` (default 256,
`DEFAULT_MAX_DEPTH`) now fails typed with a new public
`BundleDepthExceededError { root, path, limit }`, added to the
`BundleLoadError` union (`packages/core/src/Bundle.ts:77`), instead of
being silently truncated -- the same D-9 argument that unreadable subtrees
are reported, never hidden. `maxDepth` must be a positive integer,
enforced by the adapter (`packages/core/src/internal/walk.ts:56-58`).

## Config rules

`OkfitConfig` is a `Schema.Struct` where every key is `optionalKey` except
`extensions`; unknown top-level TOML keys land in `extensions` as a warning,
never an error, since config only tightens the spec
(`packages/core/CLAUDE.md:32`). `merge` is pure and never mutates -- arrays
replace wholesale. Core exports only the `OkfitConfigFile` tag; discovery,
XDG, and the layer belong to the CLI (`packages/core/CLAUDE.md:33`).
`Bundle.load` needs `FileSystem` and `Path`; `OkfitConfig.read` needs
`FileSystem`. `Graph.fromBundle` treats a path-valued field or link whose
target, resolved from its concept's directory, lands outside the bundle
root as an external reference: no graph node and no `broken-links`
diagnostic, exactly like a URL (`packages/core/README.md:26`).
`OkfitConfig.merge` deep-merges tables, applied `DEFAULTS < profile < file`
by the caller (`packages/core/README.md:15-24`). The `[lint]` table's
forty-three keys, including `generated_at_drift`, `generated_missing`,
`verified_before_change` (default `warn`) and the
ten added for OKF v0.3 (`index_metadata_invalid`, `entry_ignored`,
`value_malformed`, `value_unknown`, `frontmatter_missing`, `type_missing`,
`symlink_escape`, `superseded_by_orphan` and `superseded_by_unresolved`, all
default `warn`, and `resource_outside_project`, default `info`), and `non_concept_unlisted` (default `warn`, silent unless `[bundle] non_concepts` is set); three more, `computation_missing` (an Attested Computation with no computation; no `runtime` needed), `config_okf_version_stale` (the config's `okf_version` differs from the root index's; the message names the config file, and `--fix` never edits the config) and `generated_at_future` (a `generated.at` more than five minutes later than now, in `internal/lintRules.ts`; `GeneratedAtFuture.ts` holds the five-minute tolerance and the check for a verification that a re-stamp would make count), all three default `warn`. `ValidateOptions.configPath` carries the config file's path so the lint can name it; core reads nothing from it. All are enumerated in `okf/interfaces/okfit-config-schema.md`. `generated-missing`
(issue #73, `internal/lintRules.ts#generatedMissing`) fires only when
`actors.agent` is set and a concept's frontmatter has no `generated` block
at all (or one written as null, `""` or `[]`) -- surfacing the gap at validate
time instead of leaving it to `okfit sync`'s post-commit `skipped` report.

## Diagnostic ranges

Every lint rule in `internal/lintRules.ts` that knows its field anchors
its diagnostic at the offending value's own range through the shared
mapper `internal/frontmatter.ts#frontmatterPathRange` (`@internal`,
built from the same YAML re-parse `rangeFor` always used) and its public
wrapper `Diagnostic.ts#DiagnosticRange.forFrontmatterPath`
(`@public`, for consumers outside core, such as `@okfit/profiles` and
`@okfit/engine`, that cannot reach an internal helper):
`unknown-type` anchors at the `type` value, `field-value-unknown` at the
offending field's value, `actor-prefix-unknown` at the offending actor
value (`verified[i].by`, `generated.by`, `sources[i].author`), `stale` at
`stale_after`, and `require-verified-unmet` at `status`. A rule with
nothing to point at — `required-key-missing`, `status-missing`,
`generated-missing` — anchors at the frontmatter block instead of a key
that is not there. Bundle-level rules (`config-unknown-key`,
`missing-index`) stay range-less. A quoted YAML scalar's range includes
the surrounding quotes.

## The integrity family

`Integrity.ts` defines `Digest` (a 16-character lowercase hex string),
`IntegrityGenerated { body }`, `IntegrityVerified { by, at, content }` and
`Integrity`, and `Concept` carries an optional `integrity` field holding the decoded top-level
`x-okfit-integrity` block, read as its own family, so a malformed block yields `family-invalid`
(now the only family that does; every other family reads key by key, see
"Reading OKF v0.3 bundles") for `x-okfit-integrity` only and never drops `generated`
or `verified`. Core only
holds the shape; it never computes a digest, since that would need a
hashing capability core's no-Node-imports rule keeps out of this package.
`Generated.body_sha256` remains a lenient optional legacy string, read only
as a migration fallback and never written, and the removed `BodySha256`
schema is gone from the barrel. `verified-drift` is a registered lint code
(`verified_drift` in the `[lint]` table, default `warn`). See [Every okfit
digest lives in one integrity family](../decisions/integrity-family.md) and
the [integrity frontmatter](../interfaces/integrity-frontmatter.md)
contract; the key carries the prefix OKF v0.3 section 4.1 asks of a producer (see
[okfit's keys carry the x-okfit- prefix](../decisions/okfit-keys-carry-x-okfit-prefix.md)).

## Reading OKF v0.3 bundles

Core reads OKF v0.3 bundles and still reads v0.2 ones. The pieces:

- **Declared version.** `OkfVersion` (`parse`, `compare`, `declared`,
  `legacyFallbacks`) reads the root index's `okf_version`; one gate decides
  whether the v0.2 root fallback and the legacy computation reading apply
  ([The declared OKF version gates the v0.2
  fallbacks](../decisions/declared-okf-version-gates-fallbacks.md)).
- **Root index metadata.** `IndexDocument` carries `title`, `description`,
  `license`, `metadata` and the raw `frontmatter` of the root index; a bad
  value is `index-metadata-invalid` ([The root index's metadata is read and
  kept](../decisions/root-index-metadata-is-kept.md)).
- **Tolerant reading.** Key-by-key decode with `entry-ignored`,
  `value-malformed` and `value-unknown`; `family-invalid` is only
  `x-okfit-integrity`; `Concept.entries` (`EntryPaths`) and `Concept.entryPath` give
  a kept entry's YAML path ([Loading never fails a concept for a bad
  family](../decisions/content-tolerant-loading.md)).
- **Confined reads.** `readConfinedBytes` and `readConfinedString`
  (`ConfinedRead.ts`) open a file, resolve its path with `confineReal` and
  compare the open file's `dev` and `ino` with `lstat` of the real path, so a
  path swapped for a link out of the root, at the file or at a directory above
  it, is refused when it is read (`ConfinementError`), not only when it is
  checked. `Bundle.load` reads every Markdown file this way; a file that
  becomes a link between the link check and the read is recorded
  `symlink-escape` and left out. A hard link to a file under the root is a
  file under the root (OKF 0.3 section 3.2). Writes stay a check then an
  atomic write.
- **Non-concept markdown.** `frontmatter-missing` and `type-missing` are
  lints that skip the file; `symlink-escape` refuses a file or
  directory link out of the bundle, and a link that cannot be resolved
  ([Markdown that is not a concept is skipped](../decisions/non-concept-markdown-is-skipped.md)).
- **Trust tier.** `Derive.trustTier` counts only current verification
  events (OKF v0.3 §5.3): an event whose `at` is equal to or later than
  `generated.at` by instant, or any event when `generated` is absent (§5.3);
  okfit reads a `generated` with no `at` the same way. An earlier event stays in the file as history and counts for
  nothing. The rule applies to every bundle, whatever version it declares
  (§11.2). `Derive.isCurrent` and `Derive.currentVerifications` are public.
  A `human:` current event gives `human-reviewed`; any other current event,
  `team:` included (§7), gives `machine-confirmed`. The lint
  `verified-before-change` (default `warn`) fires only when the tier dropped
  for that reason, and exempts draft, deprecated and unknown-status
  concepts; `require-verified-unmet` still means no `verified` entry at all,
  and for an unknown status its message names a working fix.
- **Status and staleness.** `Derive.status` returns `DerivedStatus`
  (`draft`, `stable`, `deprecated`, `unknown`); `Derive.rawStatus` returns
  the value as written. `Staleness` gains `malformed`, for a `stale_after`
  that cannot be read: never fresh, never stale.
  `Derive.malformedStaleAfter(bundle)` lists those concepts (`MalformedStaleAfter`
  `{ id, raw }`, sorted by id). Timestamps accept a date-only `YYYY-MM-DD` as
  the start of that day in UTC.
- **`superseded_by`.** A typed string field on `Concept`, a sixth path
  field (`PathField` `superseded_by`) and a graph edge, so `broken-links`
  reports a dangling one and the language server's document links and
  definition follow it. `superseded-by-orphan` fires on `superseded_by`
  without `status: deprecated`; `superseded-by-unresolved` fires when a
  deprecated concept's value resolves to an asset, an external value or the
  concept itself. `Graph.replacement(bundle, id)` walks a deprecated concept's
  chain through deprecated concepts and returns the first draft or stable
  concept, or `None` for a cycle, a dead end, a missing or non-concept target,
  or an end in an unknown status ([A deprecated concept's replacement is
  followed](../decisions/superseded-by-is-followed.md)).
- **Actors.** `team:` is a known scheme (`ActorForm` `team`);
  `actor-prefix-unknown` also checks `sources[].author`, and its message
  lists `human:`, `team:`, `process:` and the producer form.
- **Reading rules.** `Graph.resolve(bundle, from, raw, field?, rule?)` takes
  a fallback rule, `"declared"` (the default), `"legacy"` or `"current"`,
  and `Bundle.inlineComputation(document, rule)` takes the same, so the
  migration report can read one bundle both ways; the rule is applied per
  call and never cached ([The declared OKF version gates the v0.2
  fallbacks](../decisions/declared-okf-version-gates-fallbacks.md)).
  `[bundle] non_concepts` is a list of globs that decodes only if each
  compiles, and has no default; the lint that reads it is
  `non-concept-unlisted`.
- **Computation.** `computationBody` follows the §10.3 locator for a bundle
  declaring 0.3 or later, and finds a fence nested in a list item or block
  quote; `executor.resource`, `executor.receipt` and `attester.resource` are
  optional; `parameters` decode per entry. A single mapping whose every key
  was dropped (`usage_window`, `executor`, `attester`) reads as absent; one
  written as `{}` is kept. A source's own `usage_window` is decoded as one
  value, so one bad key drops all of it.
- **Empty values.** `required-key-missing` treats a key written as null,
  `""` or `[]` as absent, with the message "is empty" (an unwritten key is "is
  missing"); `field-value-unknown` and `generated-missing` use the same test,
  so an empty value is absent for all three.
- **One document parse.** `Bundle.parseDocument(text)` returns
  `Result<MarkdownDocument, MarkdownParseError>`; `Bundle.load` and `okfit mv`
  both parse through it, so the two cannot disagree about what a file is.
