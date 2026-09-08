---
type: Decision
title: okfit sync is the one command that regenerates every derived-content family
description: okfit sync computes generated.at, index.md, and log.md in one command with three selectable modes, agent-runnable and never touching verified.
tags:
  - architecture
generated:
  by: okfit/claude-code
status: draft
---

# okfit sync is the one command that regenerates every derived-content family

## Context

Three families of content in the bundle are derived, not authored:
`generated.at` on every concept, `index.md` in every directory that holds
a concept, and `log.md` at the bundle root. Each is computed from the same
underlying git history, and a finalize sweep over a branch's touched
concepts wants to regenerate all three in one pass rather than reloading
the bundle three times. The command needed to decide, up front, whether
`generated.at` is persisted on disk or computed on read each time it is
needed; whether one command or three separate commands does the
regeneration; and where the resulting `generated-at-drift` lint belongs.

## Decision

Persist, not compute on read: `generated.at` is written back into each
concept's frontmatter, because the on-disk bundle must carry it for other
OKF consumers that read the file directly and never invoke `okfit`.

One command, not three: `okfit sync` runs all three modes — `generated`,
`index`, `log` — in that fixed order by default, narrowable to a subset
with repeatable `--only` flags. `generated` and `log` share the same git
walk, so a single call amortizes it, and the finalize sweep wants one
invocation over the bundle, not three each reloading it from disk.

Lint placement: the `generated-at-drift` lint lives in `@okfit/profiles`,
not `@okfit/core`, because core stays git-free — it never depends on
`Git` or `GitHistory`, and a lint that compares a stamped value against a
fresh git walk belongs with the package that already owns git-derived
provenance.

## Alternatives rejected

Computing `generated.at` on read was rejected because it would leave
nothing on disk for a non-`okfit` consumer of the bundle to read, and
would recompute the same git walk on every load instead of once at sync
time.

Three separate commands (`okfit sync-generated`, `okfit sync-index`,
`okfit sync-log`) were rejected because they would force every
multi-family caller — the finalize sweep above all — to reload the bundle
once per family for no benefit; `--only` gives the same narrowing without
the duplicated reload cost.

Putting `generated-at-drift` in core was rejected because core's whole
purpose is staying free of git and other Node-only dependencies; the lint
needs `Git | GitHistory`, which only `@okfit/profiles` already depends on.

## Consequences

A new lint, `generated-at-drift`, becomes possible now that the
derivation `sync` needs is a first-class, exposed operation rather than
internal-only: the same git walk that stamps `generated.at` can also flag
a concept whose stamped value has drifted from what a fresh walk would
compute.

The `generated-at-drift` lint and `sync`'s `generated`/`log` modes are
deliberately never guarded in CI — only `index` mode is, via `okfit sync
--dry-run --only index` — because commit dates a squash or rebase merge
rewrites would otherwise make CI spuriously fail on `main` for reasons no
contributor caused.
