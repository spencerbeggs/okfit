---
type: Module
title: Workspace
description: The monorepo root -- workspace layout, shared rules, and the build, lint, and release commands every package uses.
resource: "../.."
kind: workspace
tags:
  - architecture
generated:
  by: human:spencer
  at: 2026-09-06T10:41:29Z
  body_sha256: 492ad7454384c5030c2b2f23996d8cc3bdc6c44cd05942574116603ee16cfdd4
---

# Workspace

## Purpose

okfit's monorepo root holds the five `packages/*` workspace packages (`core`,
`profiles`, `cli`, `mcp`, `plugin`) plus `plugins/claude-code`, and
`.repos/effect`: read-only vendored Effect v4 source that is never written to
(`CLAUDE.md:16-27`). Each package has its own `CLAUDE.md` and
`__test__/CLAUDE.md` (`CLAUDE.md:30`).

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
