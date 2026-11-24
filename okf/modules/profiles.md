---
type: Module
title: Profiles
description: The opinionated layer over core -- named okfit config profiles plus derivation rules for generated.at and generated.by.
status: stable
resource: ../../packages/profiles
x-okfit-kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-11-24T20:33:07Z
x-okfit-integrity:
  generated:
    body: 3d010101a2ecbf6e
---

# Profiles

## Purpose

`@okfit/profiles` is the opinionated layer over `@okfit/core`. It ships
named profiles: a complete `OkfitConfig` value (types, tags, fields, lint
severities) plus derivation code (`generated.at` from git, human actor from
git config). Core stays opinion-free; everything that says what a bundle
*should* contain lives here (`packages/profiles/CLAUDE.md:1-6`).

## Layout

The software-project config overlay sets `[bundle] non_concepts` to
`**/README.md`, `**/AGENTS.md`, `**/CONTRIBUTING.md` and `**/SKILL.md`, beside
its `status_missing = "warn"` lint, so the `non-concept-unlisted` lint and the
plugin hook guard every other typeless `.md`.

`Profile.ts` holds the shared types (`Layout`, `ProfileDiagnostic`,
`Profile`). `SoftwareProject.ts` holds the `software-project` literal,
layout, and check -- never re-exported, reachable only via
`Profiles.softwareProject`. `Profiles.ts` is the facade: `get(name)`,
`softwareProject`. `GitHistory.ts` and `BodyProvenance.ts` are the
git-log-walking primitives. `Derivation.ts` is the
`body`/`generatedAt`/`humanActorId`/`generatedBy`/`verifier`/`staleAfter` facade
(`packages/profiles/CLAUDE.md:8-22`). `generatedAt` and `--staged` sync both
take their root from `Git.repoRoot` with `{ ignoreRepositoryEnv: true }`,
because `git rev-parse --show-toplevel` names the caller's own directory when a
linked worktree's hook exports `GIT_DIR` (#315). `verifier` resolves the human and gates them on the `[actors].humans` allow-list (`HumanActorNotAllowedError`), and `Trust` reports `actor-not-allowed` as a `DriftReason`; see [A non-empty actors list is an allow-list and okfit never stores emails](../decisions/actor-allow-list.md).

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

Effect v4 is pinned to `catalog:effected`; `@okfit/core`, `@effected/git`,
`@effected/glob`, `@effected/jsonc`, `@effected/markdown` and
`@effected/walker` are peers (Convention A) -- nothing under `src/`
imports `@effect/platform-node` or `node:child_process` directly. No
`process.cwd()` and no environment reads anywhere in `src/`: `writer` and
`cwd` are explicit arguments (P-16) (`packages/profiles/CLAUDE.md:28,31`).

## Provenance linting

`Provenance.lint(bundle, config)` runs the `generated-at-drift` lint,
requiring `Git | GitHistory | FileSystem | Path | Digest.Digest`. The lint
is two-tier: a concept carrying `x-okfit-integrity.generated.body` (or, as a
migration fallback, the 16-hex prefix of a legacy `generated.body_sha256`)
is checked by pure content comparison against `Derivation.bodyDigest` of
its current source, no git call at all; a concept without one falls back to
comparing its stamped `generated.at` against what the same git walk
`Derivation.generatedAt` would compute today. See [Every okfit digest lives
in one integrity family](../decisions/integrity-family.md).

`Derivation.bodyDigest(text)` computes the 16-hex digest of the
P-6-normalized body through effect's own `Digest` service
(`effect/crypto`), never `node:crypto` directly, so it carries
`Digest.Digest` in its R channel the same way `Derivation.generatedAt`
carries `Git | GitHistory`. The digest functions (`digestFull`, `digest`,
`bodyDigest`, `contentDigest`) have error channel `never`, since
core's `Digest` cannot fail with a typed error.
`Derivation.contentDigest(concept)` digests the body plus authored
frontmatter, encoded by the `Canonical` module: `@effected/jsonc`'s RFC 8785
canonical JSON (keys sorted by UTF-16 code unit, bookkeeping keys excluded),
relaxed only for a `bigint`, an `undefined` member, a non-finite number and
`toJSON`, all matching `JSON.stringify`. A value holding an unpaired
surrogate is not well-formed Unicode and is refused: `contentDigest` fails
with `ContentUnhashableError`, naming the frontmatter path (okfit#327).

## Trust and drift

The `Trust` module derives a `ConceptSignal`: the spec trust tier (from
current verification events only, OKF v0.3 §5.3), `integrity` of `current`,
`drifted` or `none`, a drift reason and staleness. `Trust.evaluate` decides `unbound`,
`entry-superseded`, `actor-not-allowed`, `verified-before-change` and
`content-changed`, in that order; `Trust.signal` reports `content-unhashable`
when the digest cannot be computed, before `evaluate` runs. `verified-before-change` means the bound
entry's `at` is earlier than `generated.at`, so it is no longer a current
event; it names the editor from `generated` (`edited_by`, `edited_at`), and
`Trust.evaluate` checks it after the allow-list and before it compares
digests. `verified-drift` stays silent on it, because core's
`verified-before-change` lint is the one reporter of that defect.
`Trust.boundEntry` is public: the binding when it names the latest human
entry, ignoring the allow-list and whether the entry is current. `ConceptSignal` carries both `stale`
and a required `staleness` (`fresh`, `stale`, `unknown` or `malformed`), from one
source so the two cannot disagree; a consumer that builds a `ConceptSignal`
literal must supply it. A concept whose status is unknown is skipped by
`verified-drift`, because `okfit verify` refuses it and the lint's remedy
would be unreachable ([An unknown status is not current
knowledge](../decisions/unknown-status-is-not-current.md)). `content-unhashable` means a bound
concept's content cannot be canonicalized, so its binding cannot be checked;
its `verified-drift` finding ranges at the offending value, and `okfit
verify` refuses it (engine's `VerifyContentUnhashableError`). Its
lint, `verified-drift`, fires on a drifted concept at the configured
severity (default `warn`) and does no hashing when the level is `off`.
`Trust.evaluate` and `Trust.needsDigest` are pure and shared: the lint,
the engine's summaries and the language server's already-verified check all
call them. Machine entries neither bind nor break a binding. Profiles holds this,
not core, because binding content to a verification is an okfit opinion
the spec does not make. See [A verification is bound to the content it
covered](../decisions/verification-binds-content.md) and [Verification
drift is a signal to weigh, never a gate](../decisions/drift-is-a-signal.md).
The software-project Decision guidance now tells authors to edit a Decision
whose choice still stands and to deprecate and supersede it only when the
choice changes, and names `superseded_by` (on the deprecated Decision) and
`x-okfit-supersedes` (on its successor), the profile's field keys carrying the `x-okfit-` prefix (see
[okfit's keys carry the x-okfit- prefix](../decisions/okfit-keys-carry-x-okfit-prefix.md)). The profile declares no `superseded_by` field:
it is a spec key that core already reads as a path field, and a declared path
field of the same name would be listed twice by `okfit mv`.

The `generated-at-drift` lint anchors its diagnostic at the `generated.at`
value itself (`Provenance.ts`), through
[Core](core.md)'s `DiagnosticRange.forFrontmatterPath`, rather than the
frontmatter block. `SoftwareProject.ts`'s `project-not-at-root` check
anchors the same way, at the misplaced Project concept's `type` value;
`project-missing` and `project-multiple` stay bundle-level.

## Publication linting

`Publications.lint(bundle, config)` runs the `publication-drift` and
`publication-orphan` lints over concepts of type `Publication`, requiring
`Digest.Digest`. A Publication whose `x-okfit-renders` entry carries a
`body` digest (16-hex) that no longer matches `Derivation.bodyDigest` of the rendered
source concept reports drift. An orphan is reported for an `x-okfit-surface` that
resolves to no bundle concept or to a concept whose type is not `Surface`
(the message names the actual type), an `x-okfit-renders[].path` that resolves to
nothing, an empty `x-okfit-renders` list, or a malformed one. An absent `x-okfit-surface` is
skipped here and left to `required-key-missing`.
`Publications.resolveRef(from, raw)` resolves a reference to a bundle-relative
id: a leading `/` starts from the bundle root, anything else from the
referencing file's directory; a `#` or `?` suffix is stripped and the value is
percent-decoded (a malformed escape is left as written). It returns `""` when
the reference climbs above the bundle root. It knowingly differs from core's
resolver in three ways, listed in its TSDoc: it does not treat a URL as
external (a URL yields no concept and is reported as an orphan), it has no v0.2
root fallback for a bare value, and `/` alone and a climb above the root both
yield no concept.
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
