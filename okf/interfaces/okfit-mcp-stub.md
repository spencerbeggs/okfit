---
type: Interface
title: okfit-mcp — stub MCP interface
description: The okfit-mcp bin's current phase-1 surface (a stub that always exits 1) and its planned phase-2 tool set.
kind: mcp
resource: ../../packages/mcp/src/bin.ts
status: stable
generated:
  by: human:spencer
tags:
  - architecture
---

# okfit-mcp — stub MCP interface

## Current surface

A single bin that starts, reports that the server is not implemented, and
exits `1` (`packages/mcp/README.md:7-9`).

## Planned surface (phase 2)

MCP tools over `@okfit/core`: list concepts, get by ID, search by type or
tag, graph neighbors, a stale report, and `describe_vocabulary`
(`packages/mcp/CLAUDE.md:3-6`).

## Why a stub ships now

Gives the plugin's loader (`bin/start-mcp.sh`) a real binary to resolve
today, even though `plugin.json` registers no `mcpServers` block yet — see
`interfaces/plugin-hooks-contract.md` for the loader's own contract, not
restated here (`plugins/claude-code/README.md:103-109`).

## Layout

`src/bin.ts` (the stub entry point, `#!/usr/bin/env node`) and
`src/index.ts` (the programmatic barrel) (`packages/mcp/CLAUDE.md:8-14`).
