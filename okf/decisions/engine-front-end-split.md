---
type: Decision
title: A shared @okfit/engine package replaces cli-as-copy-contract
description: The platform layer, config discovery, and the validate/verify/sync/init/context programs moved into a new @okfit/engine package that both @okfit/cli and @okfit/mcp depend on directly, replacing an auto-installed peer-dependency arrangement that could never produce a runnable bin.
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-09T04:14:34Z
verified:
  - by: human:spencer
    at: 2026-09-09T04:18:14Z
---

# A shared @okfit/engine package replaces cli-as-copy-contract

## Context

`@okfit/plugin` declared `@okfit/cli` and `@okfit/mcp` as peer
dependencies, auto-installed. A package manager links
`node_modules/.bin` entries only for an importer's DIRECT dependencies;
an auto-installed peer is resolvable but never runnable, so installing
the plugin gave a consumer neither the `okfit` nor the `okfit-mcp` bin. A
`publicHoistPattern` entry in `pnpm-workspace.yaml` addressed the
resolution half of the problem and could not touch the bin half, because
bin-linking is keyed to the dependency graph edge, not to whether a
package ends up on disk.

Separately, `@okfit/cli`'s own `CLAUDE.md` had documented `src/index.ts`
as "the copy contract for `@okfit/mcp`, planned for a later phase": the
pure pieces of the CLI's validate/verify/sync/init/context logic were to
be `@okfit/mcp`'s to import directly from the CLI's barrel. That plan
would have left `@okfit/mcp` permanently downstream of `@okfit/cli` for
every capability neither package's own concern actually is.

## Decision

`@okfit/plugin` now declares `@okfit/cli` and `@okfit/mcp` as regular
`dependencies`, each with its own bin shim under `src/bin/` that imports
`main` from the front end's `./main` subpath and calls it. Both `okfit`
and `okfit-mcp` are now direct dependencies of the package a consumer
installs, so both bins link.

The platform layer, config discovery, and the validate/verify/sync/init/
context programs — everything `@okfit/cli`'s old copy-contract barrel
would have exposed — moved out of `@okfit/cli` into a new `@okfit/engine`
package. `@okfit/cli` is reduced to a presentation shell: commands, human
renderers, `renderFailure`, and the bin/main wiring. `@okfit/mcp` depends
on `@okfit/engine` directly and no longer depends on `@okfit/cli` at all,
so installing `@okfit/mcp` alone no longer resolves `@effected/cli` or
the command tree that only a CLI needs.

The XDG application namespace literal (`"okfit"`) now exists exactly once,
as `OKFIT_APP_NAMESPACE` in `@okfit/engine`'s `platform.ts`. Both front
ends provide the same `OkfitPlatform` layer wholesale rather than each
building its own `AppDirs.layer` call, so the CLI and the MCP server
resolve the same user-level config directory structurally, not because
two independent copies happen to agree.

## Alternatives rejected

**Keep the platform layer in `@okfit/cli` and have `@okfit/mcp` import
it from there.** This was the original copy-contract plan. It leaves
`@okfit/mcp` permanently downstream of `@okfit/cli` for capabilities
that are not actually a CLI's concern — config discovery and the
validate/verify/sync/init/context programs are shared business logic,
not command-line presentation — and it does nothing to fix the peer bug,
since the bug is about the plugin's dependency edges, not about where
the shared logic lives.

**A runtime-only sixth package holding just the platform layer.** This
would have fixed only the platform-layer half of the duplication (the
XDG namespace literal) while leaving config discovery and the five
programs duplicated or still copy-contracted through `@okfit/cli`. Full
package ceremony — its own `package.json`, build, and test suite — for
roughly ten lines of layer wiring, while `@okfit/mcp` still depended on
`@okfit/cli` for everything else, so the "mcp no longer depends on cli"
story would only have been half true.

## Consequences

`pnpm add -D @okfit/mcp` no longer resolves `@effected/cli` or the
command tree. `@okfit/cli` carries a narrower `process`-read allowlist
(`bin.ts`, `main.ts`, `commands/`, `internal/exit.ts`, `internal/tty.ts`,
`version.ts`) than before, since everything under `config/`, `validate/`,
`verify/`, `sync/`, `init/`, and the envelope halves of `render/` moved
to `@okfit/engine`, which enforces its own boundary test with no
allowlist at all — no file under `engine/src` may read `process`.
Outside the workspace, installing only the packed plugin now yields both
bins in `node_modules/.bin/`: `okfit --version` exits 0, and `okfit-mcp`
answers a JSON-RPC `initialize` on stdout with empty stderr.
