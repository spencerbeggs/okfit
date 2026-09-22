---
type: Module
title: scratchpad
description: A committed but never-published pnpm workspace member that lets agents write typed probes fast against the kit's own @okfit packages and the catalog effect prerelease.
status: stable
kind: harness
resource: ../../scratchpad
tags:
  - dx
  - testing
sources:
  - id: scratchpad-claude-md
    resource: ../../scratchpad/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T23:49:20Z
  body_sha256: f641683b91a676c6605fa9cbc67bedd906bf1b7b4d217e2c0eb1180e5d8b4074
---

# scratchpad

## Purpose

`scratchpad/` lets agents write **typed** probes fast, instead of an
ad-hoc `npm install` under `/tmp` that cannot resolve the workspace's own
`effect` pin. The bug class it exists to kill is a hard question settled
by an untyped probe that silently misreads a v4 `Result` accessor or a
library's API shape -- a typed probe catches that class of mistake at
compile time instead.

## Architecture: the ghost workspace

`scratchpad/` is a real pnpm workspace member -- listed alongside
`packages/*` and `plugins/*` in `pnpm-workspace.yaml` -- so `workspace:*`
dependencies resolve and turbo, vitest-agent and pnpm treat it like any
other member. But it is a fixture, not a package: `"private": true`, no
`publishConfig`, no `savvy.build.ts`, no build scripts. Its only scripts
are the three runners (`probe`, `check`, `reset`).

Its manifest lists `effect: catalog:effect` and every published
`@okfit/*` package at `workspace:*` (`core`, `profiles`, `engine`, `cli`,
`mcp`, `plugin`) -- the manifest **is** the probe roster, so a package
missing from it is simply unprobeable here, and a new workspace package
has to be added to it explicitly. It also carries `@effected/git`,
`@effected/memfs`, `@effected/xdg` and `@effected/markdown` at
`catalog:effected`, for probes that touch what the `@okfit/*` packages
themselves touch, plus `vscode-languageserver` and `vscode-jsonrpc` as
devDependencies so LSP-roadmap probes of those two libraries type-check
here. Dev dependencies are `@effect/platform-node` and `@effect/vitest`
(`catalog:effect`), `tsx`, `typescript` and `@types/node`
(`catalog:build`). It carries no `vitest` devDependency of its own -- the
project runs through the root vitest install, and adding one locally
would only invite version skew.

Three exclusions make it a "ghost": listed in the `ignore` array of
`.changeset/config.json`; skipped by the vitest discover strategy when
`CI` is set (via `DefaultDiscoverStrategy().extend({ buildProject })` in
the root `vitest.config.ts`); and `scratchpad/**` is in the root coverage
`exclude`. The manifest itself is committed -- a fully gitignored
workspace member would cause lockfile importer churn on fresh clones --
only the probe working areas are gitignored.

## Layout

```text
scratchpad/
  package.json                 # committed -- ghost-workspace manifest
  tsconfig.json                # committed -- extends root; includes probes/, lib/scripts/, __test__/
  CLAUDE.md                    # committed -- the in-directory contract for agents
  lib/
    scripts/reset.ts           # committed -- reset script
    templates/                 # committed -- pristine seeds: probe.ts, artifact-probe.ts, probe.test.ts
  __test__/
    utils/                     # committed -- reviewed reusable helpers (assert-result.ts)
    probe.test.ts              # GITIGNORED -- seeded demo suite; agent test-probes live here
  probes/                      # GITIGNORED -- free-form tsx probes (seeded: probe.ts, artifact-probe.ts)
```

`.gitignore` excludes `scratchpad/probes/` and
`scratchpad/__test__/*.test.ts`; `__test__/utils/` stays tracked and
follows the house convention as the helpers-only folder.

## Two probe venues

There is no zero-staleness venue: workspace imports do not resolve to
`./src/index.ts`; both venues read built output and differ only in which
build they read.

- **Workspace mode** (the default for API-semantics probes): a bare
  `@okfit/<pkg>` import resolves through pnpm's workspace linking, which
  honors each package's `publishConfig`, to that package's `dist/dev`
  build. Probes type against the dev build's declarations. After editing
  a package's `src/`, run `pnpm build --filter @okfit/<pkg>` before
  trusting a tsx probe; test-shaped probes get a fresh build automatically
  via the root globalSetup.
- **Artifact mode**: deep-import
  `packages/core/dist/prod/npm/pkg/index.js` to interrogate the built prod
  artifact, typed via `as unknown as typeof import("@okfit/core")` -- the
  double cast is required because dev and prod declarations of
  private-field classes are nominally distinct. `lib/templates/artifact-probe.ts`
  demonstrates it. Build the target first.

## Three runners

- **Free-form probes**: `pnpm scratchpad:probe probes/<name>.ts` from the
  repo root (`pnpm --filter scratchpad probe` under the hood, backed by
  tsx -- bare Node cannot resolve the workspace TS setup).
- **Test-shaped probes**: `__test__/*.test.ts` with `@effect/vitest`
  (`assert.*`, never `expect`). The standard `__test__/` shape means the
  stock discover strategy picks it up as an ordinary project, so probes
  run through the root vitest CLI and the vitest-agent MCP `run_tests`,
  with persisted results and history. The documented invocation is `pnpm
  exec vitest run --project scratchpad --coverage.enabled=false` --
  without the flag, the repo's global coverage thresholds fail any
  project-scoped run, so read the Tests line, not the exit code. The
  seeded `probe.test.ts` demonstrates both shapes: `it.effect` for
  Effect-typed probes and plain `it` for sync ones.
- **Type-check probes**: `pnpm scratchpad:check` (`"check": "tsc
  --noEmit"` in the scratchpad manifest). Neither tsx nor vitest
  type-checks -- both strip types without checking -- so this is the only
  compile-time proof.

Root convenience aliases: `scratchpad:probe`, `scratchpad:check`,
`scratchpad:reset`.

## Reset

`scratchpad/lib/scripts/reset.ts`, run via `pnpm scratchpad:reset` (tsx).
It deletes the contents of the two gitignored zones only (`probes/`,
`__test__/*.test.ts`), reseeds the three files from `lib/templates/` --
`probes/probe.ts`, `probes/artifact-probe.ts` and `__test__/probe.test.ts`
-- and prints what it deleted. It runs **no git commands ever**;
committed files are outside its blast radius by construction.

## The name collision with the harness's own scratch directory

Most agent sessions are also handed a private scratch *directory* under
`/tmp`, named in the system prompt, which has no `node_modules` -- a probe
written there dies with `ERR_MODULE_NOT_FOUND: Cannot find package
'effect'`. That failure is reached by a route that feels like *following*
the venue rule rather than breaking it, which is why the committed
`scratchpad/CLAUDE.md` names the distinction explicitly: the venue is a
`scratchpad/` directory **inside the repo**, resolved from the repo root
-- see [the ghost-workspace glossary entry](../glossary/ghost-workspace.md).

## LSP-roadmap probes

Phase 3 of the LSP roadmap needs typed probes of `vscode-languageserver`'s
exit handling and `vscode-jsonrpc`'s stream-close behaviour. Both
libraries are scratchpad devDependencies (`vscode-languageserver@^10.1.1`,
`vscode-jsonrpc@^9.0.2`), so a paired-`PassThrough` probe of either
type-checks here instead of an untyped `/tmp` probe.

## Deliberately excluded (YAGNI)

- No probe archival or numbering -- gitignored means disposable; durable
  findings go to tickets or Decision/Module concepts instead.
- No turbo tasks for scratchpad itself -- even the type-check ships as a
  root alias (`scratchpad:check`) precisely to stay out of the graph.

## Testing and build

Not applicable in the ordinary sense: `scratchpad/` has no `build:dev` or
`build:prod`, and CI never sees the project (skipped when `CI` is set).
Its own "tests" are the seeded `probe.test.ts` demonstration and whatever
test-shaped probes an agent writes in the gitignored `__test__/*.test.ts`
zone, none of which gate anything.
