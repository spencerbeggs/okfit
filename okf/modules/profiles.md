---
type: Module
title: Profiles
description: The opinionated layer over core -- named okfit config profiles plus derivation rules for generated.at and generated.by.
status: stable
resource: ../../packages/profiles
kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-10-03T00:10:20Z
  body_sha256: e2e85a2b100259aa59ce4b81a7654a2905fd553fd0235ef56919add18c2bf6a9
---

# Profiles

## Purpose

`@okfit/profiles` is the opinionated layer over `@okfit/core`. It ships
named profiles: a complete `OkfitConfig` value (types, tags, fields, lint
severities) plus derivation code (`generated.at` from git, human actor from
git config). Core stays opinion-free; everything that says what a bundle
*should* contain lives here (`packages/profiles/CLAUDE.md:1-6`).

## Layout

`Profile.ts` holds the shared types (`Layout`, `ProfileDiagnostic`,
`Profile`). `SoftwareProject.ts` holds the `software-project` literal,
layout, and check -- never re-exported, reachable only via
`Profiles.softwareProject`. `Profiles.ts` is the facade: `get(name)`,
`softwareProject`. `GitHistory.ts` and `BodyProvenance.ts` are the
git-log-walking primitives. `Derivation.ts` is the
`body`/`generatedAt`/`humanActorId`/`generatedBy`/`staleAfter` facade
(`packages/profiles/CLAUDE.md:8-22`).

`presets/` holds the docs-surface presets (`DocsPreset`, `SurfaceTemplate`):
`npm-package`, `monorepo-router`, `monorepo-shared-docs` and the additive
`site`. Each is a set of Surface templates whose bodies instruct the page
author, exposed as `Profile.docsPresets`.

`GitHistory.layer` no longer spawns git itself: it is a thin adapter over
`@effected/git` 0.12.0's `Git.log`, forwarding `paths: [path], follow:
true, firstParentDiffMerges: true` and an optional `limit` verbatim
(`packages/profiles/src/GitHistory.ts:86-115`). `NotARepositoryError`
passes through unchanged; a `GitCommandError` maps onto this package's own
`GitHistoryError`; the 30 s ceiling is now `@effected/git`'s own
`GIT_TIMEOUT` inside `Git.log`, whose synthesized `GitCommandError` detail
(`timed out after 30s`) reaches `GitHistoryError` unchanged -- this adapter
no longer imposes one of its own. An entry with an empty
`CommitLogEntry.paths` (a merge TREESAME to its first parent) is dropped,
matching the old parser's behaviour
(`packages/profiles/src/GitHistory.ts:99-113`).
`src/internal/pathLog.ts` and `src/internal/spawn.ts` no longer exist.

## Rules and boundaries

Effect v4 is pinned to `catalog:effect`; `@okfit/core`, `@effected/git`, and
`@effected/markdown` are peers (Convention A) -- nothing under `src/`
imports `@effect/platform-node` or `node:child_process` directly. No
`process.cwd()` and no environment reads anywhere in `src/`: `writer` and
`cwd` are explicit arguments (P-16) (`packages/profiles/CLAUDE.md:28,31`).

## Provenance linting

`Provenance.lint(bundle, config)` runs the `generated-at-drift` lint,
requiring `Git | GitHistory | FileSystem | Path | Crypto.Crypto`. The lint
is two-tier: a concept carrying `generated.body_sha256` is checked by pure
content comparison against `Derivation.bodyDigest` of its current source,
no git call at all; a concept without one falls back to comparing its
stamped `generated.at` against what the same git walk
`Derivation.generatedAt` would compute today. See [A body digest inside
generated detects real drift, not a rewritten
date](../decisions/profiles-body-sha256-detects-real-drift.md).

`Derivation.bodyDigest(text)` computes that digest — a lowercase hex
sha256 of the P-6-normalized body — through effect's own `Crypto` service,
never `node:crypto` directly, so it carries `Crypto.Crypto` in its R
channel the same way `Derivation.generatedAt` carries `Git | GitHistory`.

The `generated-at-drift` lint anchors its diagnostic at the `generated.at`
value itself (`Provenance.ts`), through
[Core](core.md)'s `DiagnosticRange.forFrontmatterPath`, rather than the
frontmatter block. `SoftwareProject.ts`'s `project-not-at-root` check
anchors the same way, at the misplaced Project concept's `type` value;
`project-missing` and `project-multiple` stay bundle-level.

## Publication linting

`Publications.lint(bundle, config)` runs the `publication-drift` and
`publication-orphan` lints over concepts of type `Publication`, requiring
`Crypto.Crypto`. A Publication whose `renders` entry carries a
`body_sha256` that no longer matches `Derivation.bodyDigest` of the rendered
source concept reports drift. An orphan is reported for a `surface` that
resolves to no bundle concept or to a concept whose type is not `Surface`
(the message names the actual type), a `renders[].path` that resolves to
nothing, an empty `renders` list, or a malformed one. An absent `surface` is
skipped here and left to `required-key-missing`.
`@okfit/engine`'s `validate/run.ts#run` runs these lints only when the
resolved profile is `software-project`, so a `profile = "none"` repository
that declares its own `Publication` type gets none of them. It appends them to
`report.lint`, as it
does `lintSurfaces` (`surface-unmatched`, in `validate/surfaces.ts`), which
warns when a Surface's glob `resource` matches nothing on disk.

## Derivation is package-global

`Derivation` is package-global, not per profile; it never rewrites
`generated.by` on re-derivation and never substitutes `now` for an
uncommitted body -- both are the caller's decision
(`packages/profiles/CLAUDE.md:30`). The README's TOML fence is a test
fixture -- `__test__/SoftwareProject.test.ts` decodes it and deep-equals it
against the `software-project` literal, so the two are kept in lockstep
(`packages/profiles/CLAUDE.md:34`).
