# CLAUDE.md

Guidance for Claude Code in the okfit repository.

## What this is

okfit is Node.js tooling for the
[Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
v0.2, published under the `@okfit` npm scope. It is both a general OKF
toolkit and the successor to the design-docs workflow for keeping a
repository's knowledge base current.

The design spec lives locally (gitignored) at
`docs/superpowers/specs/2026-09-04-okfit-monorepo-design.md`.

## Layout

```text
packages/
  core/        @okfit/core      spec-level schemas, bundle loader, graph, validate
  profiles/    @okfit/profiles  named config profiles (software-project)
  cli/         @okfit/cli       the `okfit` bin
  mcp/         @okfit/mcp       the `okfit-mcp` bin (stub until phase 2)
  plugin/      @okfit/plugin    meta-package users install
plugins/
  claude-code/ the okfit Claude Code plugin (private, release-only)
.repos/effect  read-only vendored Effect v4 source; never write under .repos/
```

Each package has its own `CLAUDE.md` and `__test__/CLAUDE.md`.

## Rules

- Effect v4 only, at the version in `catalog:effect`. Consult
  `.repos/effect/packages/effect/src` for what v4 exports; `node_modules`
  wins on disagreement.
- `@okfit/core` has no opinions and no Node-only imports. Opinions go in
  `@okfit/profiles` or config.
- Tests live in `__test__/`, never in `src/`.
- Relative imports use `.js` extensions; built-ins use `node:`.
- Commits are conventional, DCO signed, and never on `main`.

## Commands

```bash
pnpm build        # dual dev + prod builds via Turbo
pnpm typecheck    # tsc --noEmit per package via Turbo
pnpm lint         # Biome
pnpm lint:md      # markdownlint
pnpm test         # Vitest across the monorepo (builds dist/dev first)
pnpm test:bats    # BATS for plugin shell scripts
pnpm claude       # Claude Code with the local plugin loaded
```

Run one package's tests with `pnpm vitest run packages/core`.

## Build and release

`@savvy-web/bundler` produces `dist/dev` and `dist/prod` per package and
flips `private` on publish; never set `"private": false` in a source
`package.json`. Changesets with `@savvy-web/changelog` version everything;
`plugins/claude-code` is tagged but never published to npm, and its
`plugin.json` version is mirrored from its `package.json`.
