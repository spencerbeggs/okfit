---
type: Module
title: Plugin
description: The meta-package a consuming repository installs to get both the okfit CLI and okfit-mcp bins on PATH.
resource: ../../packages/plugin
kind: package
generated:
  by: okfit/claude-code
  at: 2026-09-09T05:07:51Z
  body_sha256: ba088339810722eda154d74c47e802d8f648523c7c51896b5936cd57653363b9
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

## Dependencies, not peers

`@okfit/cli` and `@okfit/mcp` are declared as regular `dependencies`, each
with its own bin shim under `src/bin/`. A package manager links
`node_modules/.bin` entries only for an importer's DIRECT dependencies, so
the peer arrangement the spec calls for could never produce a runnable
bin -- this is settled, not provisional. See [A shared @okfit/engine
package replaces cli-as-copy-contract](../decisions/engine-front-end-split.md)
for the full reasoning and the alternatives rejected.
