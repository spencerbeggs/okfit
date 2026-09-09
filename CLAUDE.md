# CLAUDE.md

Guidance for Claude Code in the okfit repository.

## What this is

okfit is Node.js tooling for the
[Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
v0.2, published under the `@okfit` npm scope. Full purpose, boundaries,
and non-goals: `okf/project.md`.

The design spec lives locally (gitignored) at
`docs/superpowers/specs/2026-09-04-okfit-monorepo-design.md`.

## Where things live

This repository dogfoods its own OKF bundle at `okf/`. Start at
`okf/index.md` for the full map; by area:

- **The workspace root, every package, and the Claude Code plugin** --
  `okf/modules/*.md` (`workspace`, `core`, `profiles`, `engine`, `cli`,
  `mcp`, `plugin`, `claude-code-plugin`).
- **Durable architectural choices** (why something is built the way it
  is, not just what it does) -- `okf/decisions/*.md`.
- **Rules contributors and agents must follow** -- `okf/conventions/*.md`.
  The bullets below are the ones a session needs immediately; full
  rationale and citations live in the bundle.
- **Contracts other code depends on** (the CLI, the config schema, the
  plugin's hooks, the MCP stub) -- `okf/interfaces/*.md`.
- **External material this repo must cite reliably** --
  `okf/references/okf-spec.md`.

Each package has its own `CLAUDE.md` and `__test__/CLAUDE.md`.

## Rules

- Effect v4 only, at the version in `catalog:effect`. Consult
  `.repos/effect/packages/effect/src` for what v4 exports; `node_modules`
  wins on disagreement. `.repos/effect` is read-only vendored source;
  never write under `.repos/`.
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

Run one package's tests with `pnpm vitest run packages/core`. The
`okfit` CLI's own commands (`validate`, `init`, `context`, `verify`,
`sync`) are documented in `okf/interfaces/cli-commands.md`.

## Build and release

Never set `"private": false` in a source `package.json`; no changesets until
Spencer calls the initial release. Mechanics (the dual build, versioning,
`plugins/claude-code`'s tag-only publish): the workspace module, under
`okf/modules/*.md`.
