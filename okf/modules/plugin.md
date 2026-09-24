---
type: Module
title: Plugin
description: The meta-package a consuming repository installs to get the okfit CLI, okfit-mcp, and okfit-lsp bins on PATH.
status: stable
resource: ../../packages/plugin
kind: package
generated:
  by: okfit/claude-code
  at: 2026-09-24T16:04:08Z
  body_sha256: 9a78f78b4fb0f122aa5fcb31077ee541183277cbaf43b8f425c7831b8d9881c9
---

# Plugin

## Purpose

`@okfit/plugin` is the meta-package. It ships no behavior of its own; it
exists so a consuming repo installs one package and gets all three bins.
The Claude Code plugin's loaders (`plugins/claude-code`) run `okfit-mcp`
and `okfit-lsp` from the consuming repo's install of this package
(`packages/plugin/CLAUDE.md:1-6`): `pnpm add -D @okfit/plugin`
(`packages/plugin/README.md:3-7`). The plugin registers those bins as
`mcpServers.mcp` and `lspServers.okfit`, so the six MCP tools reach an
agent as `mcp__plugin_okfit_mcp__<tool>` — see
`okf/interfaces/okfit-mcp.md` — and the language server publishes
diagnostics without a tool call — see [LSP](lsp.md).

## Dependencies, not peers

`@okfit/cli`, `@okfit/mcp`, and `@okfit/lsp` are declared as regular
`dependencies`, each with its own bin shim under `src/bin/okfit.ts`,
`src/bin/okfit-mcp.ts`, and `src/bin/okfit-lsp.ts`. Each shim calls its front end's
`main({ distribution: { name: "@okfit/plugin", version: PLUGIN_VERSION } })`,
so a report or `okfit --version` produced through this package names it
(`via @okfit/plugin <version>`) while a direct install of a front end
reports `distribution: null` — see [The engine version, not the producer
version, is what a report is compared
on](../decisions/engine-version-is-the-comparable-version-effected-kit.md). A package manager links
`node_modules/.bin` entries only for an importer's DIRECT dependencies, so
the peer arrangement the spec calls for could never produce a runnable
bin -- this is settled, not provisional. See [A shared @okfit/engine
package replaces cli-as-copy-contract](../decisions/engine-front-end-split-effected-kit.md)
for the full reasoning and the alternatives rejected.
