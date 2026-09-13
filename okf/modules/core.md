---
type: Module
title: Core
description: The no-internal-deps base package -- OKF v0.2 frontmatter schemas, bundle loading, the link graph, derivation, and validation, with no opinions about bundle content.
resource: ../../packages/core
kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-09T22:33:03Z
  body_sha256: af1bd882ac0e8e736290fe7c3ed003551be099b0c91311b2a546d551428962f6
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
`merge`, `severityFor`, `read`, and the `OkfitConfigFile` tag.
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
seventeen keys, including `generated_at_drift`, are enumerated in
`okf/interfaces/okfit-config-schema.md`.

## generated.body_sha256

`Generated` carries an optional third key, `body_sha256` — a lowercase
64-character hex sha256 of a concept's body, validated by a new `BodySha256`
schema. Core only holds the field; it never computes a digest itself, since
that would need a hashing capability core's no-Node-imports rule keeps out
of this package. See [A body digest inside generated detects real drift,
not a rewritten date](../decisions/profiles-body-sha256-detects-real-drift.md).
