---
type: Module
title: Engine
description: The shared okfit engine -- platform layer, config discovery, and the validate/verify/sync/init/context programs both the CLI and the MCP server depend on directly.
resource: ../../packages/engine
kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-09T22:33:03Z
  body_sha256: 1b4b643e34755bc34b0fec1aca9309d2e47d3f0bf42d99d431cbaabc36bb4aaf
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
end's human-readable rendering to render there instead.

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

## Process boundary

`__test__/boundaries.test.ts` enforces that NO file under `engine/src`
reads `process`, with no per-file allowlist — a stricter rule than either
front end's own boundary test carries, because this package is a library
both a CLI and an MCP server import: a `process` read here would bake a
runtime environment read into whichever front end imports it first
(`packages/engine/CLAUDE.md`).
