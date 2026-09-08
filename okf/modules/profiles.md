---
type: Module
title: Profiles
description: The opinionated layer over core -- named okfit config profiles plus derivation rules for generated.at and generated.by.
resource: ../../packages/profiles
kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-08T14:33:59Z
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
requiring `Git | GitHistory | FileSystem | Path` to compare each
concept's stamped `generated.at` against what the same git walk
`Derivation.generatedAt` uses would compute today.

## Derivation is package-global

`Derivation` is package-global, not per profile; it never rewrites
`generated.by` on re-derivation and never substitutes `now` for an
uncommitted body -- both are the caller's decision
(`packages/profiles/CLAUDE.md:30`). The README's TOML fence is a test
fixture -- `__test__/SoftwareProject.test.ts` decodes it and deep-equals it
against the `software-project` literal, so the two are kept in lockstep
(`packages/profiles/CLAUDE.md:34`).
