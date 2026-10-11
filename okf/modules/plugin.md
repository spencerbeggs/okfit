---
type: Module
title: Plugin
description: The meta-package a consuming repository installs to get the okfit CLI, okfit-mcp, and okfit-lsp bins on PATH.
status: stable
resource: ../../packages/plugin
kind: package
generated:
  by: okfit/claude-code
  at: 2026-10-11T20:51:30Z
integrity:
  generated:
    body: f11d7c313971016a
---

# Plugin

## Purpose

`@okfit/plugin` is the meta-package. It ships no behavior of its own; it
exists so a consuming repo installs one package and gets all three bins.
The agent plugin's loaders (`plugin/`) run `okfit-mcp`
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
on](../decisions/comparable-version.md). A package manager links
`node_modules/.bin` entries only for an importer's DIRECT dependencies, so
the peer arrangement the spec calls for could never produce a runnable
bin -- this is settled, not provisional. See [A shared @okfit/engine
package replaces cli-as-copy-contract](../decisions/engine-front-end-split.md)
for the full reasoning and the alternatives rejected.

## Shared bins, proven packed

The three front ends declare the same bin names, deliberately; see [The carrier
keeps its front ends' bin names, proven under
allowSharedBins](../decisions/plugin-shared-bins.md).
`packages/plugin/__test__/e2e/packed-install.e2e.test.ts` installs the packed
tarballs under npm, pnpm and bun (all required in `CI`; Yarn is
exercised only where it is installed, and its slot row is asserted only on
Yarn 2+) and runs this package's own bins with
`runCarrierBin`, so it proves the published artifact rather than `dist/dev`. It
needs the prod build: it skips without it locally and fails under `CI`.
