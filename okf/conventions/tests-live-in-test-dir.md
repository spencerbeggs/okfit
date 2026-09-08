---
type: Convention
title: Tests live in __test__/, never in src/
description: Every package's tests sit under __test__/; nothing under src/ is a test file.
status: stable
generated:
  by: human:spencer
  at: 2026-09-06T10:47:04Z
tags:
  - testing
stale_after: "2026-12-05T00:00:00Z"
---

# Tests live in __test__/, never in src/

## Rule

Every package's tests sit under `__test__/`, never under `src/` (root
`CLAUDE.md:39`). This applies uniformly across the workspace, including the
Claude Code plugin's own BATS suite (`plugins/claude-code/__test__/*.bats`).

## Why

Keeping `src/` test-free means the published `dist/dev`/`dist/prod` output
never carries test-only code, and keeps each package's own
`__test__/CLAUDE.md` the one place to look for that package's test
conventions rather than scattering them next to the implementation (root
`CLAUDE.md:30`).

## Where stated

`packages/core/CLAUDE.md:28` (`@effect/vitest`, `@effected/memfs`, fixtures
under `__test__/fixtures/`); `packages/cli/CLAUDE.md:66,109` (tests live in
`__test__/`, never in `src/`); `packages/profiles/CLAUDE.md:24` (same rule,
package-specific `__test__/CLAUDE.md`).

## Enforcement

Not mechanically enforced today — unlike the process-boundary convention
(`process-reads-confined-in-cli.md`), which is backed by a real test, this
one is a code-review convention so far.
