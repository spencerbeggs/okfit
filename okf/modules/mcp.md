---
type: Module
title: MCP
description: The okfit-mcp Model Context Protocol server; a stub bin in phase 1 so the Claude Code plugin loader has a real target.
resource: ../../packages/mcp
kind: package
generated:
  by: human:spencer
---

# MCP

## Purpose

`@okfit/mcp` is the `okfit-mcp` bin. Phase 2 implements MCP tools over
`@okfit/core`: list concepts, get by ID, search by type or tag, graph
neighbors, stale report, and `describe_vocabulary`. Phase 1 ships only a
stub bin so the Claude Code plugin loader has a real target
(`packages/mcp/CLAUDE.md:1-6`). Once implemented, it gives agents
structured access to an OKF bundle (`packages/mcp/README.md:3`).

## Status

Skeleton. The `okfit-mcp` bin starts, reports that the server is not
implemented, and exits `1` (`packages/mcp/README.md:7-9`). Layout is two
files: `bin.ts` (the `#!/usr/bin/env node` entry, a stub that exits 1) and
`index.ts` (the programmatic barrel); e2e tests spawn
`dist/dev/pkg/bin/okfit-mcp.js` (`packages/mcp/CLAUDE.md:8-16`).
