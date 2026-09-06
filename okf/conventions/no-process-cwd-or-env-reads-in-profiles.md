---
type: Convention
title: No process.cwd() or environment reads in profiles
description: '@okfit/profiles never calls process.cwd() or reads an environment variable; writer and cwd are always explicit arguments.'
status: stable
generated:
  by: human:spencer
tags:
  - architecture
stale_after: "2026-12-05T00:00:00Z"
---

# No process.cwd() or environment reads in profiles

## Rule

No file under `packages/profiles/src/` calls `process.cwd()` or reads an
environment variable; `writer` and `cwd` are always explicit arguments to
the functions that need them (`packages/profiles/CLAUDE.md:31`).

## Why

`Derivation`'s `generatedAt`, `humanActorId`, and the rest need a
caller-supplied `cwd` and `writer` to stay deterministic and testable
against a throwaway git repository in a temp directory. It is the same
discipline `@okfit/core` applies to `now` — an explicit argument, never a
`Clock` service (`packages/core/CLAUDE.md:11-12`) — extended here to the
filesystem and environment axis.

## Scope

Every file under `packages/profiles/src/`, most concretely `Derivation.ts`
(the facade that needs `writer`/`cwd` to resolve an actor and a body's
provenance) and `GitHistory.ts` (which needs an explicit repository path
rather than inferring one from the current directory).

## Where stated

`packages/profiles/CLAUDE.md:31`.
