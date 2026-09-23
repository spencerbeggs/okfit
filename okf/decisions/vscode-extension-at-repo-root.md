---
type: Decision
title: The VS Code extension lives at vscode/, not under plugins/ or packages/
description: '@okfit/vscode-extension lives at the workspace root under vscode/, sibling to packages/* and plugins/claude-code, rather than under either directory.'
status: draft
tags:
  - dx
  - release
generated:
  by: okfit/claude-code
  at: 2026-09-23T18:05:30Z
  body_sha256: 1a274f2ee03e85823263b79fc4fc1ecf900ce49122b42da56183fee4d51c2631
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
publisher `okfit`), sibling to `packages/*` and `plugins/claude-code`
rather than nested under either.

## Alternatives rejected

- `plugins/vscode` -- `plugins/` holds AI-agent plugins with
  `.claude-plugin` manifests, distributed through a Claude Code plugin
  marketplace and consumed by an agent host (see [Claude Code
  Plugin](../modules/claude-code-plugin.md)). An editor extension is a
  different distribution (the VS Code Marketplace and Open VSX, packaged
  as a `.vsix`) and a different audience (a human in an editor, not an
  agent host), so nesting it under the directory that means "agent plugin"
  would misname what it is.
- `packages/vscode` -- `packages/` holds npm-published libraries and bins
  (`core`, `profiles`, `engine`, `cli`, `mcp`, `lsp`, `plugin`); every
  member's `package.json` is an npm package manifest. The extension never
  publishes to npm at all (`vscode/package.json`'s `"private": true"`,
  mirroring `plugins/claude-code`'s own tag-only posture), and its
  `package.json` is a VS Code extension manifest first --
  `contributes`, `activationEvents`, `engines.vscode`, `publisher`,
  `galleryBanner` -- so the fields that shape the file are not the ones
  `packages/*` optimizes for.

## Consequences

`vscode/` gets its own top-level entry in [Workspace](../modules/workspace.md)'s
layout list, alongside `packages/*` and `plugins/claude-code`, rather than
a bullet nested under either. A future editor-extension package (a second
IDE target, for instance) has this directory's naming precedent to follow
rather than a choice to re-litigate.
