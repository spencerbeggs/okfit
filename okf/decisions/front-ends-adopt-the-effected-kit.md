---
type: Decision
title: okfit's front ends build on @effected/{engine,cli,mcp} rather than hand-rolled equivalents
description: "@okfit/cli, @okfit/mcp, @okfit/engine and the workspace's own boundary tests now depend on effected's front-end kit -- @effected/engine, @effected/cli, @effected/mcp, and @effected/workspaces -- in place of copies this repository hand-rolled and maintained itself."
status: stable
tags:
  - architecture
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-24T15:35:44Z
  body_sha256: 310f5e3e2ecbdee0d4e61efbbef23f18903cf6f1905d1369ac7aa4eb6266ee5b
sources:
  - id: main-ts
    resource: ../../packages/cli/src/main.ts
  - id: version-formatter
    resource: ../../packages/cli/src/internal/versionFormatter.ts
  - id: mcp-server-ts
    resource: ../../packages/mcp/src/server.ts
  - id: mcp-errors-ts
    resource: ../../packages/mcp/src/errors.ts
  - id: distribution-ts
    resource: ../../packages/engine/src/render/distribution.ts
  - id: layers-json
    resource: ../../layers.json
  - id: workspace-layering-test
    resource: ../../__test__/workspaceLayering.test.ts
  - id: pnpm-plugin-effect
    resource: npm:@effected/pnpm-plugin-effect
verified:
  - by: human:spencer
    at: 2026-09-24T15:59:56Z
---

# okfit's front ends build on @effected/{engine,cli,mcp} rather than hand-rolled equivalents

## Context

Before this Decision, three front-end concerns were hand-rolled and
duplicated inside this repository rather than sourced from a shared
package:

- `@okfit/cli`'s `main.ts` hand-assembled `Command.run`, a `ShowHelp`
  exit-code remap, and `CliOutput.layer`; its own `internal/tty.ts`
  re-implemented the no-color.org rule (`isTTY && NO_COLOR !== "1"`) as the
  package's only reader of `process.stdout.isTTY`/`process.env.NO_COLOR`.
- `@okfit/mcp`'s `errors.ts` hand-rolled `Remediation`,
  `composeRemediatedMessage`, and `truncateEchoed`; `server.ts` and
  `main.ts` built directly on `effect/unstable/ai/McpServer.layerStdio`/
  `.toolkit` and a hand-assembled `Layer.launch`/`teardown` pair, including
  a hand-written `LogToStderr` provide and a `Cause.hasInterruptsOnly`
  remap for stdin EOF.
- `@okfit/cli`, `@okfit/engine`, and `@okfit/lsp` each carried their own
  `__test__/utils/boundaries.ts` scanner -- comment-stripping, `process`-
  read detection, and (for `cli` and `lsp`) an import-name walker -- three
  independently maintained copies of the same logic, with no check at all
  that the workspace's package-dependency graph itself honoured its
  intended layering.

`effected` (the sibling kit this repository already depends on for
`@effected/git`, `@effected/xdg`, `@effected/config-file`, and others)
shipped a front-end kit distilled from exactly this kind of duplication
across its own consumers: `@effected/engine` (`Distribution`,
`DistributionField`, `LaunchContext`, `Remediation`, `CurrentDistribution`,
`distributionSuffix`), `@effected/cli` (`CliRuntime.main`, `CliColor`),
`@effected/mcp` (`McpStdio`, `McpToolkit`, `ToolFailure`), and
`@effected/workspaces` (`SourceBoundary`, `WorkspaceLayering`,
`LayerPolicy`), all resolved through the `@effected/pnpm-plugin-effect`
catalog this repository already opts into for the `effect` version
itself.[^pnpm-plugin-effect]

## Decision

Adopt the kit across all three front ends and the workspace's own tests,
replacing the hand-rolled equivalent each one used before, at the versions
`@effected/pnpm-plugin-effect` 0.11.0 resolves: `@effected/engine` 0.1.0,
`@effected/mcp` 0.1.0, `@effected/cli` 0.8.0, `@effected/workspaces`
0.26.0.

- **`@okfit/engine`** re-exports `Distribution`/`DistributionField` from
  `@effected/engine` (`render/distribution.ts`) instead of declaring its
  own `{ name, version }` struct, so `@okfit/cli`'s `CurrentDistribution`
  reference and every envelope in this package agree on one shape rather
  than two hand-rolled structs drifting apart.[^distribution-ts]
- **`@okfit/cli`** runs on `@effected/cli`'s `CliRuntime.main`, which
  already provides `platform` inside failure reporting, a fresh
  `CliExit` cell, and the logger outermost, and already remaps a
  `ShowHelp` carrying parse errors to the usage exit code -- the
  hand-rolled assembly and remap in `main.ts` are gone.[^main-ts] Colour
  goes through `CliColor.enabled`/`CliColor.formatterLayer`, read from the
  ambient `ConfigProvider` rather than `process` directly; `internal/tty.ts`
  is deleted.[^version-formatter] The distribution comes from
  `@effected/engine`'s `CurrentDistribution` reference, provided once in
  `main.ts`; `internal/distribution.ts` is deleted.
- **`@okfit/mcp`** runs on `McpStdio.launch`/`.teardown`/`.layer` and
  `McpToolkit.layer` in place of hand-wiring
  `effect/unstable/ai/McpServer.layerStdio`/`.toolkit` directly.[^mcp-server-ts]
  `errors.ts` is built on `ToolFailure` (`@effected/mcp`) and `Remediation`
  (`@effected/engine`) instead of this package's own
  `composeRemediatedMessage`/`truncateEchoed`.[^mcp-errors-ts] The project
  root resolves through `@effected/engine`'s `LaunchContext.projectDir`,
  which additionally guards against a launch context that still carries a
  literal, unexpanded `${CLAUDE_PROJECT_DIR}` placeholder -- protection the
  old hand-rolled `??` chain did not have.
- **The workspace root** gained `layers.json` and
  `__test__/workspaceLayering.test.ts`, checking the real package manifest
  dependency graph against the intended layering (`plugin` → `cli`/`mcp`/
  `lsp` → `engine` → `profiles` → `core`) with `@effected/workspaces/testing`'s
  `WorkspaceLayering`/`LayerPolicy` -- a check that did not exist in any
  form before this Decision.[^layers-json] [^workspace-layering-test]
- **`@okfit/engine`, `@okfit/cli`, and `@okfit/lsp`'s own
  `__test__/boundaries.test.ts`** now scan through
  `@effected/workspaces/testing`'s `SourceBoundary` in place of each
  package's own hand-rolled scanner; `@okfit/lsp`'s policy collapses to one
  scan with per-rule `allowRules`, and `@okfit/cli`'s policy now bans any
  import of `@effected/app` at all (`{ forbidImports: ["@effected/app"] }`),
  broader than the old three-name (`App`/`AppStore`/`AppCache`) rule.
  `@okfit/engine` keeps one small hand-rolled scanner
  (`findAppImportNames`) beside its own `SourceBoundary`-based `process`
  check, because `SourceBoundary`'s `forbidImports` forbids a whole module
  specifier, never specific named imports from an otherwise-legitimate one
  -- `@okfit/engine`'s own `config/layer.ts` legitimately imports
  `AppConfig` from `@effected/app`, so the blanket rule `@okfit/cli` uses
  is not available to it.

**User-visible change:** `NO_COLOR` used to disable colour only when it
was exactly `1` (`internal/tty.ts`'s own `!== "1"` check); `CliColor`
follows the no-color.org rule instead, so any non-empty value now
disables colour, and an explicitly empty `NO_COLOR=""` does not. Exit
codes and the JSON/human output contract are otherwise unchanged.

## Alternatives rejected

**Keep okfit's own copies and let them diverge from the kit.** This is
the status quo the Context section describes: three independently
maintained boundary scanners with no cross-check against each other, a
CLI colour rule that quietly disagreed with the ecosystem convention
every other tool in a user's shell follows, and no check at all that the
workspace's actual package graph matched the layering this repository
already assumes in prose (`CLAUDE.md`'s "Where things live" section,
every package's own `CLAUDE.md`). Continuing to hand-roll each of these
means re-deriving and re-fixing the same bugs the kit's own authors
already found and fixed in their consumers -- the MCP stdin-guard
(`-32700`/`-32600` on a malformed line, never wedging) and the
unknown-argument-naming behaviour below are exactly that class of fix.

**Adopt only the pieces with no behavioural change (`Distribution`,
`SourceBoundary`) and hand-keep the CLI/MCP assembly.** Rejected: the
whole point of a front-end kit is that `main.ts`'s assembly order (logger
outermost, platform inside failure reporting, the `ShowHelp` remap) and
the MCP stdin guard are exactly the kind of subtle sequencing bugs worth
sourcing from one maintained place rather than re-deriving per repository;
adopting the kit selectively would leave the harder half of the
duplication in place.

## Consequences

- **MCP wire changes**, from `McpToolkit.layer` and `McpStdio.layer`:
  every served tool's `inputSchema` is now closed
  (`additionalProperties: false` at every object node); an unknown
  argument is rejected with one `InvalidParams` naming every unknown key
  at every depth, not just the first. A stdin line that is not JSON gets a
  JSON-RPC `-32700` reply and the server keeps serving (core's own decoder
  would otherwise throw on that line again for every later chunk and stop
  answering); JSON that is not a JSON-RPC message (`null`, a bare number,
  an object with neither `method` nor `id`) gets `-32600` and the server
  keeps serving.
- The `mcp-stateless-first-protocol-list` Decision's claim that this
  package "uses native `McpServer.toolkit`" no longer holds literally --
  it now goes through `@effected/mcp`'s `McpToolkit.layer`, which runs
  core's own `registerToolkit` unchanged underneath and adds the
  unknown-key pre-check above; the protocol list and its ordering rules
  that Decision states are otherwise unaffected.
- `okf/conventions/process-reads-confined-in-cli.md`'s allowlist is
  narrower: `internal/tty.ts` no longer exists, so the CLI's own
  `process`-read surface is `bin.ts`, `main.ts`, `commands/*.ts`, and
  `internal/exit.ts`; colour is now the kit's own ambient-`ConfigProvider`
  read, never a `process` read this package performs directly.
- A future rc bump to `effect` moves through the kit's own re-pin rather
  than three independent copies of "does this scanner still parse the
  installed AST shape"; `pnpm-workspace.yaml`'s `@effected/pnpm-plugin-effect`
  catalog entry is the one place that re-pin happens.

[^pnpm-plugin-effect]: npm:@effected/pnpm-plugin-effect
[^distribution-ts]: ../../packages/engine/src/render/distribution.ts
[^main-ts]: ../../packages/cli/src/main.ts
[^version-formatter]: ../../packages/cli/src/internal/versionFormatter.ts
[^mcp-server-ts]: ../../packages/mcp/src/server.ts
[^mcp-errors-ts]: ../../packages/mcp/src/errors.ts
[^layers-json]: ../../layers.json
[^workspace-layering-test]: ../../**test**/workspaceLayering.test.ts
