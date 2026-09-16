---
type: Module
title: Engine
description: The shared okfit engine -- platform layer, config discovery, and the validate/verify/sync/init/context programs both the CLI and the MCP server depend on directly.
status: stable
resource: ../../packages/engine
kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-16T19:53:53Z
  body_sha256: baa157009c4a9be6f0179c9f04879041baf941e802a9573a341ff22d7c936816
---

# Engine

## Purpose

`@okfit/engine` holds the platform layer, config discovery, and the
validate/verify/sync/init/context programs shared by `@okfit/cli` and
`@okfit/mcp`, plus the JSON envelope contracts both front ends render
(`packages/engine/CLAUDE.md:1-6`). It replaces the arrangement where
`@okfit/cli`'s own barrel was the copy contract `@okfit/mcp` depended on
— see [A shared @okfit/engine package replaces
cli-as-copy-contract](../decisions/engine-front-end-split.md) for why.
`@okfit/mcp` depends on this package directly and no longer depends on
`@okfit/cli` at all.

## The platform layer

`platform.ts`'s `OkfitPlatform` is the one XDG/Node platform layer both
front ends provide wholesale, built around a single
`OKFIT_APP_NAMESPACE` literal (`"okfit"`) that exists exactly once in the
whole codebase. Both `@okfit/cli` and `@okfit/mcp` resolve the same
user-level config directory structurally, because they provide the same
layer, rather than by two independently maintained copies agreeing
(`packages/engine/CLAUDE.md`).

## Config discovery and the five programs

`config/layer.ts#buildConfigLayer` builds the two-branch `AppConfig.layer`
call (`--config <file>` given vs. the upward-walk-plus-XDG chain) that
`okfit-config-schema.md` and `okf/decisions/cli-config-discovery-*.md`
describe from the consumer's side. `validate/run.ts`, `verify/{locate,
splice,run}.ts`, `sync/{generated,index,log,write,run}.ts`, and
`init/scaffold.ts` are the five programs; `render/*.ts` holds the
envelope half of each JSON contract (`ContextEnvelope`, `VerifyEnvelope`,
`SyncEnvelope`, `JsonEnvelope`/`JsonErrorEnvelope`), leaving each front
end's human-readable rendering to render there instead. `version.ts`
exports `ENGINE_VERSION`, the one build-time constant in this package
(`process.env.__PACKAGE_VERSION__`, replaced by the bundler), and every
envelope renderer stamps it as `engine_version` itself rather than taking
it from the caller; the renderers also take an optional `distribution`
the front ends thread through from `main()`. See [The engine version, not
the producer version, is what a report is compared
on](../decisions/engine-version-is-the-comparable-version.md).

`validate/run.ts#run` and `sync/run.ts#runSync` both now carry
`Crypto.Crypto` in their dependencies, satisfied for free wherever
`OkfitPlatform`/`NodeServices.layer` already runs, since `@okfit/profiles`'
`Provenance.lint` and `Derivation.bodyDigest` need it for the two-tier
`generated-at-drift` lint. `verify/locate.ts`'s single-field
`locateGenerated` generalized into a private `locateGeneratedField(source,
field)` plus a public `locateGeneratedBodySha256`, and `verify/splice.ts`
gained `spliceGeneratedFields`, which merges the `at` and `body_sha256`
edits into one when both anchor at the same insertion offset — two
zero-length inserts at one offset are the "overlapping edits" case
`MarkdownEdit.applyAll` treats as a programmer error. See [A body digest
inside generated detects real drift, not a rewritten
date](../decisions/profiles-body-sha256-detects-real-drift.md).

`verify/run.ts#runVerifyBatch` attests a whole selection at once --
`--all`, narrowed or replaced by `--type <T>` -- instead of one id at a
time: it collects every concept whose type sets `require_verified` and
that carries no entry by the caller, skips `status: draft` concepts and
ones already verified by the caller, and fails closed (nothing written)
if any selected concept's `verified` shape cannot be spliced safely. An
empty or undeclared-type selection is a typed `VerifySelectionError`
(exit `64`), matching the single-id path's usage-error tier. `render/*.ts`
gained `VerifyBatchEnvelope` alongside the single-concept
`VerifyEnvelope` for `--format json`.

`sync/run.ts#runSync` walks git lazily now: a concept whose recorded
`generated.body_sha256` still matches its current body, and that log mode
does not need for its date window, is never read through git at all --
only unstamped concepts, or stamped ones the log window still wants,
pay the git cost. On this bundle `okfit sync --dry-run` dropped from
1.68s to 0.27s. `sync/generated.ts#syncGenerated` is digest-first: a
missing `generated:` block is created from `actors.agent` rather than
reported as an unfixable gap, and `sync/log.ts`'s log mode appends into
the newest logged day (inclusive) instead of only after it, deduping
against the two mechanical spellings `sync` itself writes -- see [okfit
sync's log mode appends into the newest logged day and dedupes on its own
spellings](../decisions/cli-sync-log-appends-into-the-day.md), which
supersedes the strictly-after rule. `--since <YYYY-MM-DD>` widens that
floor on request. A `staged` mode (`sync/write.ts`) selects only the git
index, stamps `generated.at` with `now` (truncated to seconds) and
`generated.body_sha256` with the body's digest, writes, and re-adds what
it wrote so the stamp lands in the same commit -- meant for a pre-commit
hook only, never for an ordinary run; see [okfit sync --staged stamps the
git index with now, the one place a wall-clock stamp is
honest](../decisions/cli-sync-staged-stamps-now.md). Staged mode never
walks history and never runs log mode. A malformed `--since` or an
`--only log` paired with `--staged` is a new `SyncStagedLogError`, exit
`64`.

## Process boundary

`__test__/boundaries.test.ts` enforces that NO file under `engine/src`
reads `process`, with `version.ts` the single allowlisted exception
(its read is a build-time constant, not a runtime one) — a stricter rule than either
front end's own boundary test carries, because this package is a library
both a CLI and an MCP server import: a `process` read here would bake a
runtime environment read into whichever front end imports it first
(`packages/engine/CLAUDE.md`).
