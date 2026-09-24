---
type: Module
title: MCP
description: The okfit-mcp Model Context Protocol server, exposing six read-only tools and static concept resources over stdio.
status: stable
resource: ../../packages/mcp
kind: package
generated:
  by: okfit/claude-code
  at: 2026-09-24T16:04:08Z
  body_sha256: 3c09e7fe0825f9f3c674548b950762edfe4ebdcd602bce6029d0b60177a455b6
---

# MCP

## Purpose

`@okfit/mcp` is the `okfit-mcp` bin. It implements MCP tools over
`@okfit/core`: `list_concepts`, `get_concept`, `concept_neighbors`,
`stale_report`, `validate_bundle`, and `describe_vocabulary` — see
`okf/interfaces/okfit-mcp.md` for the exact contract. It gives agents
structured access to an OKF bundle (`packages/mcp/README.md:3`). For the
`generated-at-drift` lint's fallback tier (a concept with no recorded
`generated.body_sha256`), `validate_bundle` still spawns read-only `git
log`/`git show` through its `Git`/`GitHistory` dependencies — the server's
"writes nothing, ever" promise stands, since a read is not a write. For a
migrated concept the same lint now runs as pure content comparison
through `Crypto.Crypto`, also part of `validate_bundle`'s dependencies,
with no git call at all — see [A body digest inside generated detects
real drift, not a rewritten date](../decisions/profiles-body-sha256-detects-real-drift.md).

This package depends on [Engine](engine.md) directly -- for the platform
layer (`OkfitPlatform`), the config/bundle loading `validate_bundle`
wraps, and the `render`/`json` envelope pieces its tools re-export
unchanged -- and no longer depends on `@okfit/cli` at all, so
`pnpm add -D @okfit/mcp` no longer resolves `@effected/cli` or the
command tree. See [A shared @okfit/engine package replaces
cli-as-copy-contract](../decisions/engine-front-end-split-effected-kit.md).

It also depends directly on `@effected/mcp` and `@effected/engine`: the
server assembly, its error shape, and project-root resolution build on
that kit rather than on hand-rolled equivalents -- see [okfit's front ends
build on @effected/{engine,cli,mcp} rather than hand-rolled
equivalents](../decisions/front-ends-adopt-the-effected-kit.md).

## Status

The server implements MCP over stdio, on `@effected/mcp`'s
`McpStdio`/`McpToolkit` (themselves built on `effect/unstable/ai/McpServer`):
six read-only tools and static concept resources; see
`okf/interfaces/okfit-mcp.md`.

Layout, `packages/mcp/src`: `bin.ts` (shebang entry point), `main.ts`
(crash guards, `OkfitPlatform`, `McpStdio.launch`/`.teardown`), `index.ts`
(programmatic barrel), `version.ts`
(`MCP_VERSION`, what `initialize` reports; the `validate_bundle` envelope
names the engine separately — see [The engine version, not the producer
version, is what a report is compared
on](../decisions/engine-version-is-the-comparable-version-effected-kit.md)),
`server.ts` (`ServerLayer`: `McpToolkit.layer` and resource layers
over `McpStdio.layer`, its three-adapter `protocols` list and the exported
`SERVER_INSTRUCTIONS` string -- see [The MCP server is Effect-native and
lists the stateless 2026-07-28 adapter
first](../decisions/mcp-stateless-first-protocol-list.md)), `toolkit.ts` (`OkfitToolkit`, the six tools plus
handler wiring), `errors.ts` (`McpToolError` union, built on
`@effected/mcp`'s `ToolFailure` and `@effected/engine`'s `Remediation`),
`schema/` (per-tool parameter and success
schemas), `tools/` (one file per tool), `resources/` (the index and
concept resources), `internal/` (project root resolution over
`@effected/engine`'s `LaunchContext.projectDir`, per-call
config/bundle loading, the optional-`now` helper).

`McpToolkit.layer` closes every served tool's `inputSchema`
(`additionalProperties: false` at every object node) and rejects an
unknown argument with one `InvalidParams` naming every unknown key at
every depth; `McpStdio.layer` answers a non-JSON stdin line with a
JSON-RPC `-32700` and valid JSON that is not a JSON-RPC message with
`-32600`, in both cases without dropping the connection. See
`okf/interfaces/okfit-mcp.md` for the tool and resource contract this
holds for.
