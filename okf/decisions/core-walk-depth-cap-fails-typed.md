---
type: Decision
title: A walk past maxDepth fails typed, never silently truncates
description: Bundle.load fails with a typed BundleDepthExceededError when the walk descends past maxDepth, rather than silently truncating the walk at the cap.
tags:
  - architecture
generated:
  by: okfit/claude-code
status: draft
---

# A walk past maxDepth fails typed, never silently truncates

## Context

Core's walk moved from a hand-rolled recursion to a thin adapter over
`@effected/walker`'s `descend(pattern, { onUnreadable: "record" })`
(`packages/core/src/internal/walk.ts:52-78`). `descend` enforces a
`maxDepth` (default 256, `DEFAULT_MAX_DEPTH`) and can report a
`depthExceeded` reason on its `DescendError`. Whatever `Bundle.load` does
with that reason decides whether a bundle deeper than the cap loads with a
silently smaller membership or fails outright.

## Decision

`Bundle.load` maps a `DescendError` whose `reason` is `"depthExceeded"`
onto a new public `BundleDepthExceededError { root, path, limit }`, added
to the `BundleLoadError` union (`packages/core/src/Bundle.ts:77`), and
fails the whole load rather than returning a `LoadedBundle` that silently
omits everything below the cap. `maxDepth` must be a positive integer,
enforced by the adapter itself
(`packages/core/src/internal/walk.ts:56-58`); unreadable subdirectories
are unaffected and still become sorted `walk-unreadable` diagnostics
(`packages/core/src/internal/walk.ts:68-77`), and an unreadable root still
fails with `BundleReadError`.

## Alternatives rejected

Silent truncation -- returning whatever `descend` had matched up to the
cap as if it were the whole bundle -- was the behaviour before this round
and is rejected here: it would silently change a bundle's concept
membership depending on how deep a contributor happened to nest
directories, the same failure mode `core-loading-never-fails-on-content.md`
and this package's own D-9 rule against hidden unreadable subtrees already
forbid. A configurable "truncate with a warning diagnostic" middle ground
was also considered and rejected: a depth cap is a structural bound on the
walk, not bundle content, so it belongs with the other typed
`BundleLoadError` cases (`BundleRootNotFoundError`, `BundleReadError`)
rather than becoming another lint diagnostic content-loading tolerates.

## Consequences

A bundle nested deeper than `maxDepth` (or a caller who passes an
unreasonably small `maxDepth`) now fails `Bundle.load` outright instead of
silently loading a truncated bundle; a caller that wants a deeper walk
raises `maxDepth` explicitly rather than discovering the truncation after
the fact.
