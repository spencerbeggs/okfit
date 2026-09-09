---
type: Convention
title: process reads confined to the CLI's boundary files
description: Only bin.ts, commands/*.ts, internal/exit.ts, and internal/tty.ts read process; every other file under packages/cli/src is pure or Effect-typed.
status: stable
generated:
  by: human:spencer
  at: 2026-09-06T10:47:04Z
  body_sha256: a3d51c68c62d904432b356892c9e84511eb721066efc2d8cd7a83a4619e6be99
tags:
  - architecture
stale_after: "2026-12-05T00:00:00Z"
---

# process reads confined to the CLI's boundary files

## Rule

`process` is read only in `bin.ts`, `commands/*.ts`, `internal/exit.ts`, and
`internal/tty.ts`; every file under `render/`, `validate/`, `init/`, and
`config/anchor.ts` has no `process` access and no `@effect/platform-node`
import (`packages/cli/CLAUDE.md:73-77`).

## Why

Pure renderers, the scaffold builder, and path-resolution code are directly
unit-testable without a real process. The same boundary lets `@okfit/mcp`
(phase 2) import those pure pieces straight from the barrel without also
inheriting a CLI-only side effect it has no use for
(`packages/cli/CLAUDE.md:97-108`).

## No App/AppStore/AppCache outside two files

Only `config/layer.ts` (`AppConfig.layer`) and `bin.ts`
(`AppDirs`/`Xdg` from `@effected/xdg`) touch `@effected/app`'s app-directory
machinery — no file under `src/` imports `App`, `AppStore`, or `AppCache`.
This is what keeps phase 1 from ever creating a `store.db` or `cache.db`
(`packages/cli/CLAUDE.md:77-81`).

## Enforcement

Backed by a real test, `__test__/boundaries.test.ts` — unlike most of the
other conventions in this bundle, this one fails a build when violated.

## Where stated

`packages/cli/CLAUDE.md:73-81`.
