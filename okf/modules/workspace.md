---
type: Module
title: Workspace
description: The monorepo root -- workspace layout, shared rules, and the build, lint, and release commands every package uses.
status: stable
resource: "../.."
kind: workspace
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-11-13T16:43:01Z
integrity:
  generated:
    body: 34319287f8d0b0f4
---

# Workspace

## Purpose

okfit's monorepo root holds the seven `packages/*` workspace packages (`core`,
`profiles`, `engine`, `cli`, `mcp`, `lsp`, `plugin`) plus `plugin`,
`vscode`, `website`, and
`.repos/effect`: read-only vendored Effect v4 source that is never written to
(`CLAUDE.md:16-27`). Each package has its own `CLAUDE.md` and
`__test__/CLAUDE.md` (`CLAUDE.md:30`).

## Layout

- `packages/*` -- one directory per `@okfit` library (`core`, `profiles`,
  `engine`, `cli`, `mcp`, `lsp`, `plugin`).
- `plugin` -- the pluginfinity source of the okfit agent plugin (private
  workspace package `@okfit/ai-plugins`), built into Claude Code and GitHub
  Copilot plugins, tagged but never published to npm; see [AI
  Plugins](ai-plugins.md).
- `vscode` -- the `okfit` VS Code extension (`@okfit/vscode-extension`),
  tagged but never published to npm; see [VS Code
  Extension](vscode-extension.md).
- `website` -- the RSPress documentation site (package `docs`, private,
  never published), fed by each package's prod-build API models; see
  [Website](website.md).
- `.repos/effect` -- read-only vendored Effect v4 source.
- `scratchpad/` -- a ghost workspace member: a private typed-probe venue,
  never published, excluded from changesets, CI and coverage; see
  [scratchpad](scratchpad.md).
- `layers.json` -- the intended package-dependency layering (`plugin` →
  `cli`/`mcp`/`lsp` → `engine` → `profiles` → `core`), checked against the
  real package manifest graph by `packages/plugin/__test__/e2e/workspaceLayering.e2e.test.ts`
  through `@effected/workspaces/testing`'s `WorkspaceLayering`/
  `LayerPolicy` -- see [okfit's front ends build on
  @effected/{engine,cli,mcp} rather than hand-rolled
  equivalents](../decisions/effected-kit-adoption.md).

## Rules

- Effect v4 only, at the version pinned in `catalog:effected` (held to one minor); `node_modules`
  wins over `.repos/effect` on any disagreement between the two.
- `@okfit/core` has no opinions of its own and no Node-only imports; opinions
  about what a bundle should contain belong in `@okfit/profiles` or config.
- Tests live in `__test__/`, never in `src/`.
- Relative imports use `.js` extensions; built-ins use `node:`.
- Commits are conventional, DCO signed, and never made on `main`.

## Commands

- `pnpm build` -- `effected package build` per package via Turbo (`--filter=!docs`).
- `pnpm typecheck` -- `tsc --noEmit` per package via Turbo.
- `pnpm lint` -- Biome.
- `pnpm lint:md` -- markdownlint.
- `pnpm test` -- Vitest across the monorepo; builds `dist/prod` first. The
  packed-install e2e suites (`packages/{plugin,cli,mcp}/__test__/e2e/packed-install.e2e.test.ts`)
  need that build: they skip without it locally and fail
  under `CI`, and `ci:test` runs `turbo run build` before vitest. In `CI`
  they require npm, pnpm and bun (`devEngines.runtime` names bun so
  `silk-runtime-action` installs it); locally they run whichever of npm, pnpm
  and bun are installed.
- `pnpm test:bats` -- BATS for the plugin's shell scripts.
- `pnpm claude` -- Claude Code with the local plugin loaded.
- `pnpm dev` and `pnpm preview` -- the documentation site's dev server and
  built-site preview, run through Turbo filtered to `docs`.

Scope a single package's tests with `pnpm vitest run packages/core`
(`CLAUDE.md:55`).

## Build and release

`effected package build` (from `@effected/plugin`, configured per package
by `effected.toml`) writes `dist/prod` and flips `private` in the built
manifest. There is no dev build and no link directory: a workspace link
resolves through `exports` to a sibling's `src/`, so `pnpm-workspace.yaml`
sets `nodeOptions: --import=tsx` and every source bin registers tsx itself
for a run outside pnpm (a git hook, an MCP loader). The website's scripts
clear `NODE_OPTIONS`, since RSPress loads its own bundles; a source `package.json` never sets
`"private": false"` directly. Changesets, with `@savvy-web/changelog`,
version everything. `plugin/` (`@okfit/ai-plugins`) is tagged but never published to
npm, and both built `plugin.json` versions are mirrored from its own `package.json`
(`CLAUDE.md:59-63`).
