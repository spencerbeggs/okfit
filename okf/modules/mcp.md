---
type: Module
title: MCP
description: The okfit-mcp Model Context Protocol server, exposing six read-only tools and static concept resources over stdio.
resource: ../../packages/mcp
kind: package
generated:
  by: okfit/claude-code
  at: 2026-09-08T09:16:37Z
---

# MCP

## Purpose

`@okfit/mcp` is the `okfit-mcp` bin. It implements MCP tools over
`@okfit/core`: `list_concepts`, `get_concept`, `concept_neighbors`,
`stale_report`, `validate_bundle`, and `describe_vocabulary` — see
`okf/interfaces/okfit-mcp.md` for the exact contract. It gives agents
structured access to an OKF bundle (`packages/mcp/README.md:3`). For the
`generated-at-drift` lint, `validate_bundle` now spawns read-only `git
log`/`git show` through its `Git`/`GitHistory` dependencies — the server's
"writes nothing, ever" promise stands, since a read is not a write.

## Status

The server implements MCP over stdio (`effect/unstable/ai/McpServer`):
six read-only tools and static concept resources; see
`okf/interfaces/okfit-mcp.md`.

Layout, `packages/mcp/src`: `bin.ts` (crash guards, platform layer,
`runMain`), `index.ts` (programmatic barrel), `version.ts`
(`MCP_VERSION`), `server.ts` (`ServerLayer`: toolkit and resource layers
over `layerStdio`), `toolkit.ts` (`OkfitToolkit`, the six tools plus
handler wiring), `errors.ts` (`McpToolError` union,
`composeRemediatedMessage`), `schema/` (per-tool parameter and success
schemas), `tools/` (one file per tool), `resources/` (the index and
concept resources), `internal/` (project root resolution, per-call
config/bundle loading, the optional-`now` helper).
