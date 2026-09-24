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
  by: human:spencer
  at: 2026-09-24T15:35:44Z
  body_sha256: 1849a00762b9f72894f1a2decc92e06b882f18a1c6401442180dd6b724e2cca7
---

# Workspace

## Purpose

okfit's monorepo root holds the seven `packages/*` workspace packages (`core`,
`profiles`, `engine`, `cli`, `mcp`, `lsp`, `plugin`) plus `plugins/claude-code`,
`vscode`, and
`.repos/effect`: read-only vendored Effect v4 source that is never written to
(`CLAUDE.md:16-27`). Each package has its own `CLAUDE.md` and
`__test__/CLAUDE.md` (`CLAUDE.md:30`).

## Layout

- `packages/*` -- one directory per `@okfit` library (`core`, `profiles`,
  `engine`, `cli`, `mcp`, `lsp`, `plugin`).
- `plugins/claude-code` -- the Claude Code plugin, tagged but never
  published to npm.
- `vscode` -- the `okfit` VS Code extension (`@okfit/vscode-extension`),
  tagged but never published to npm; see [VS Code
  Extension](vscode-extension.md).
- `.repos/effect` -- read-only vendored Effect v4 source.
- `scratchpad/` -- a ghost workspace member: a private typed-probe venue,
  never published, excluded from changesets, CI and coverage; see
  [scratchpad](scratchpad.md).
- `layers.json` -- the intended package-dependency layering (`plugin` →
  `cli`/`mcp`/`lsp` → `engine` → `profiles` → `core`), checked against the
  real package manifest graph by `__test__/workspaceLayering.test.ts`
  through `@effected/workspaces/testing`'s `WorkspaceLayering`/
  `LayerPolicy` -- see [okfit's front ends build on
  @effected/{engine,cli,mcp} rather than hand-rolled
  equivalents](../decisions/front-ends-adopt-the-effected-kit.md).

## Rules

- Effect v4 only, at the version pinned in `catalog:effect`; `node_modules`
  wins over `.repos/effect` on any disagreement between the two.
- `@okfit/core` has no opinions of its own and no Node-only imports; opinions
  about what a bundle should contain belong in `@okfit/profiles` or config.
- Tests live in `__test__/`, never in `src/`.
- Relative imports use `.js` extensions; built-ins use `node:`.
- Commits are conventional, DCO signed, and never made on `main`.

## Commands

- `pnpm build` -- dual dev and prod builds via Turbo.
- `pnpm typecheck` -- `tsc --noEmit` per package via Turbo.
- `pnpm lint` -- Biome.
- `pnpm lint:md` -- markdownlint.
- `pnpm test` -- Vitest across the monorepo; builds `dist/dev` first.
- `pnpm test:bats` -- BATS for the plugin's shell scripts.
- `pnpm claude` -- Claude Code with the local plugin loaded.

Scope a single package's tests with `pnpm vitest run packages/core`
(`CLAUDE.md:55`).

## Build and release

`@savvy-web/bundler` produces `dist/dev` and `dist/prod` per package and
flips `private` on publish; a source `package.json` never sets
`"private": false"` directly. Changesets, with `@savvy-web/changelog`,
version everything. `plugins/claude-code` is tagged but never published to
npm, and its `plugin.json` version is mirrored from its own `package.json`
(`CLAUDE.md:59-63`).
