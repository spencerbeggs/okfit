---
type: Convention
title: Effect v4 pinned to catalog:effect
description: Every okfit package uses Effect v4 at the version pinned in catalog:effect; node_modules wins over the vendored source on disagreement.
status: stable
generated:
  by: human:spencer
  at: 2026-09-06T10:47:04Z
tags:
  - architecture
stale_after: "2026-12-05T00:00:00Z"
---

# Effect v4 pinned to catalog:effect

## Rule

Every package — `core`, `profiles`, `cli` — uses Effect v4 only, at
whatever version `catalog:effect` pins in the workspace's pnpm catalog; no
package declares its own `effect` version (root `CLAUDE.md:34-36`).

## Why the vendored source is a reference, not a dependency

`.repos/effect/packages/effect/src` is read-only vendored source, consulted
to look up what v4 actually exports; nothing under any package's `src/`
imports from it (root `CLAUDE.md:27,34-36`).

## Tie-break rule

When the vendored source and the installed `node_modules` disagree about
what v4 exports, `node_modules` wins — it is what actually builds and runs
(root `CLAUDE.md:35-36`).

## Where it's restated

`packages/cli/CLAUDE.md:70-72` (v4 only, `.repos/effect/packages/effect/src/unstable/cli`
for `effect/unstable/cli`, `node_modules` wins) and
`packages/profiles/CLAUDE.md:28` (v4 only, at the `catalog:effect` version).
