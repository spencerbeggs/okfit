---
type: Convention
title: process reads confined to the CLI's boundary files
description: Only bin.ts, main.ts, commands/*.ts, and internal/exit.ts read process; every other file under packages/cli/src is pure or Effect-typed.
status: stable
generated:
  by: okfit/claude-code
  at: 2026-09-24T16:04:08Z
  body_sha256: b8c20b93b90904d220a1acd988f551a24d5362dc31b66dcaff6814be95870795
tags:
  - architecture
stale_after: "2026-12-05T00:00:00Z"
---

# process reads confined to the CLI's boundary files

## Rule

`process` is read only in `bin.ts`, `main.ts`, `commands/*.ts`, and
`internal/exit.ts`; every file under `render/`, `validate/`, `init/`, and
`config/anchor.ts` has no `process` access and no `@effect/platform-node`
import (`packages/cli/CLAUDE.md`). `internal/tty.ts`, this package's former
`isTTY`/`NO_COLOR` reader, is gone: colour is now decided by
`@effected/cli`'s `CliColor`, read through the ambient `ConfigProvider`
rather than `process` directly, so this package performs no colour-related
`process` read of its own at all. `version.ts`'s
`process.env.__PACKAGE_VERSION__` needs no allowlist entry either: it is a
build-time constant the bundler substitutes, which `SourceBoundary`'s
`process` rule (below) exempts unconditionally.

## Why

Pure renderers, the scaffold builder, and path-resolution code are directly
unit-testable without a real process. The same boundary lets `@okfit/mcp`
import those pure pieces straight from `@okfit/engine`'s barrel without also
inheriting a CLI-only side effect it has no use for.

## No @effected/app import at all

This package imports nothing from `@effected/app` — no file under `src/`
imports `App`, `AppStore`, `AppCache`, or anything else from that module.
Config discovery, and the `AppConfig.layer` call that needs
`@effected/app`, moved to `@okfit/engine`'s `config/layer.ts` (see
[A shared @okfit/engine package replaces
cli-as-copy-contract](../decisions/engine-front-end-split-effected-kit.md)); this
package has had no reason to import the module since.

## Enforcement

Backed by a real test, `__test__/boundaries.test.ts` — unlike most of the
other conventions in this bundle, this one fails a build when violated.
It runs on `@effected/workspaces/testing`'s `SourceBoundary`, in place of
this package's own former hand-rolled comment-stripping scanner: one scan
combining a `process`-read rule (allowlisting `bin.ts`, `main.ts`,
`commands/**`, and `internal/exit.ts`) with a blanket
`{ forbidImports: ["@effected/app"] }` rule, broader than a three-name
(`App`/`AppStore`/`AppCache`) allowlist would be — see [okfit's front ends
build on @effected/{engine,cli,mcp} rather than hand-rolled
equivalents](../decisions/front-ends-adopt-the-effected-kit.md).

## Where stated

`packages/cli/CLAUDE.md`, `packages/cli/__test__/boundaries.test.ts`.
