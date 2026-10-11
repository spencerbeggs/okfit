---
type: Module
title: Core
description: The no-internal-deps base package -- OKF v0.2 frontmatter schemas, bundle loading, the link graph, derivation, and validation, with no opinions about bundle content.
status: stable
resource: ../../packages/core
kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-10-11T03:57:51Z
integrity:
  generated:
    body: 7e68362edaff355f
---

# Core

## Purpose

`@okfit/core` is the no-internal-deps base package; every other `@okfit/*`
package depends on it (`packages/core/CLAUDE.md:1-5`). It owns OKF v0.2
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
per-family schema files -- `Actor.ts`, `Timestamp.ts`, `Source.ts`,
`Generated.ts`, `Verification.ts`, `Status.ts`, `AttestedComputation.ts` --
sit alongside `Concept.ts`, `Bundle.ts`, `Graph.ts`, `Derive.ts`, and
`Validate.ts`. `OkfitConfig.ts` holds the spec 4.2 struct, `DEFAULTS`,
`merge`, `severityFor`, `read`, the `OkfitConfigFile` tag, and the whole
config JSON Schema contract -- `okfitConfigDocumentFields`,
`CONFIG_SCHEMA_VERSION`, `okfitConfigSchemaHost`, `SCHEMA_DIRECTIVE` --
which `lib/configs/schemastore.config.ts` publishes to the repo-root
`schemas/` tree via `pnpm schema:build` / `schema:check` (see [The engine
version, not the producer version, is what a report is compared
on](../decisions/engine-version-is-the-comparable-version-effected-kit.md)).
`internal/` is the engine: `posixPath`, `position`, `walk`, `frontmatter`,
`reserved`, `links`, `lintRules`, `templates`
(`packages/core/CLAUDE.md:17-26`).

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
twenty-three keys, including `generated_at_drift` and `generated_missing`, are
enumerated in `okf/interfaces/okfit-config-schema.md`. `generated-missing`
(issue #73, `internal/lintRules.ts#generatedMissing`) fires only when
`actors.agent` is set and a concept's frontmatter has no `generated` block
at all -- surfacing the gap at validate time instead of leaving it to
`okfit sync`'s post-commit `skipped` report.

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
`Integrity`, and `Concept` carries an optional top-level `integrity`
decoded as its own family, so a malformed block yields `family-invalid`
for `integrity` only and never drops `generated` or `verified`. Core only
holds the shape; it never computes a digest, since that would need a
hashing capability core's no-Node-imports rule keeps out of this package.
`Generated.body_sha256` remains a lenient optional legacy string, read only
as a migration fallback and never written, and the removed `BodySha256`
schema is gone from the barrel. `verified-drift` is a registered lint code
(`verified_drift` in the `[lint]` table, default `warn`). See [Every okfit
digest lives in one integrity family](../decisions/integrity-family.md) and
the [integrity frontmatter](../interfaces/integrity-frontmatter.md)
contract.
