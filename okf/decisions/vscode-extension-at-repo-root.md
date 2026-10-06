---
type: Decision
title: The VS Code extension lives at vscode/, not under plugins/ or packages/
description: '@okfit/vscode-extension lives at the workspace root under vscode/, sibling to packages/* and plugin/, rather than under either directory.'
status: draft
tags:
  - dx
  - release
generated:
  by: okfit/claude-code
  at: 2026-10-06T04:20:11Z
  body_sha256: 9ac3c605960f5ba9ede6786113ff2bc1d518e17ea3c8e58c54efb0a859f176af
verified:
  - by: human:spencer
    at: 2026-09-24T00:30:18Z
---

# The VS Code extension lives at vscode/, not under plugins/ or packages/

## Context

The LSP roadmap's phase 6 needed a home for `@okfit/vscode-extension`: an
editor extension with a language client, a tree view, a status item and
commands, packaged as a `.vsix` and published to the Visual Studio
Marketplace and Open VSX, never to npm. [Workspace](../modules/workspace.md)
already has two directories that look like plausible homes -- `plugins/`
(the Claude Code plugin) and `packages/*` (the seven npm-published
libraries) -- and neither fits.

## Decision

The extension lives at the workspace root, `vscode/`, tracked by the
workspace package `@okfit/vscode-extension` (Marketplace id `okfit`,
publisher `okfit`), sibling to `packages/*` and `plugin/` (the agent
plugin source; when this decision was made it was `plugins/claude-code`)
rather than nested under either.

## Alternatives rejected

- `plugins/vscode` -- `plugins/` held AI-agent plugins with
  `.claude-plugin` manifests, distributed through a Claude Code plugin
  marketplace and consumed by an agent host (that directory has since been
  replaced by the root `plugin/` pluginfinity source; see [AI
  Plugins](../modules/ai-plugins.md)). An editor extension is a
  different distribution (the VS Code Marketplace and Open VSX, packaged
  as a `.vsix`) and a different audience (a human in an editor, not an
  agent host), so nesting it under the directory that means "agent plugin"
  would misname what it is.
- `packages/vscode` -- `packages/` holds npm-published libraries and bins
  (`core`, `profiles`, `engine`, `cli`, `mcp`, `lsp`, `plugin`); every
  member's `package.json` is an npm package manifest. The extension never
  publishes to npm at all (`vscode/package.json`'s `"private": true"`,
  mirroring the agent plugin's own tag-only posture), and its
  `package.json` is a VS Code extension manifest first --
  `contributes`, `activationEvents`, `engines.vscode`, `publisher`,
  `galleryBanner` -- so the fields that shape the file are not the ones
  `packages/*` optimizes for.

## Consequences

`vscode/` gets its own top-level entry in [Workspace](../modules/workspace.md)'s
layout list, alongside `packages/*` and `plugin`, rather than
a bullet nested under either. A future editor-extension package (a second
IDE target, for instance) has this directory's naming precedent to follow
rather than a choice to re-litigate.
