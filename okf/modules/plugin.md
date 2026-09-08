---
type: Module
title: Plugin
description: The meta-package a consuming repository installs to get both the okfit CLI and okfit-mcp bins on PATH.
resource: ../../packages/plugin
kind: package
generated:
  by: okfit/claude-code
  at: 2026-09-07T00:13:55Z
---

# Plugin

## Purpose

`@okfit/plugin` is the meta-package. It ships no behavior of its own; it
exists so a consuming repo installs one package and gets both bins. The
Claude Code plugin's loader (`plugins/claude-code`) runs `okfit-mcp` from
the consuming repo's install of this package
(`packages/plugin/CLAUDE.md:1-6`): `pnpm add -D @okfit/plugin`
(`packages/plugin/README.md:3-7`). The plugin registers that bin as
`mcpServers.mcp`, so the six tools it serves reach an agent as
`mcp__plugin_okfit_mcp__<tool>` — see `okf/interfaces/okfit-mcp.md`.

## Dependencies versus peers

The spec calls `@okfit/cli` and `@okfit/mcp` peer dependencies; they are
declared as regular dependencies for now because `workspace:*` peers do
not give the monorepo root a runnable `okfit` bin -- revisit before the
first npm publish (`packages/plugin/CLAUDE.md:15-19`).
