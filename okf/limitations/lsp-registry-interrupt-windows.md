---
type: Limitation
title: Two narrow interrupt windows in the LSP session registry are documented, not closed
description: An interrupt landing in one of two narrow windows inside the session registry's rebuild and folder-build paths either skips a session's dispose or leaks its scope; both windows need a fiber interrupted at a point only shutdown or transport scope close can reach, and phase 4's final review accepted them as documented edges rather than fixed.
bounds: ../modules/lsp.md
tags:
  - architecture
sources:
  - id: registry
    resource: ../../packages/lsp/src/session/registry.ts
generated:
  by: okfit/claude-code
  at: 2026-09-23T08:34:50Z
  body_sha256: a6428a6dcc4c02f7d96bc1a61106600a8e7b410780e2a6ea415d1c433aeba96c
status: draft
---

# Two narrow interrupt windows in the LSP session registry are documented, not closed

## Condition

`packages/lsp/src/session/registry.ts` has two places where a fiber
interrupt landing between a state transition and the effect that follows
it produces an outcome the registry does not clean up after[^registry]:

1. **`rebuild`'s swap-then-dispose gap.** `rebuild(bundleRoot)` builds the
   fresh session(s) for a root, then does one `Ref.modify` that removes
   the old root entry from state and installs the new one, and only
   after that `Ref.modify` returns calls `disposeEntry` on the entry the
   swap replaced. An interrupt between the `Ref.modify` returning and
   `disposeEntry` running leaves the old session's scope open and its
   `onDispose` never called.
2. **A folder build's make-then-install gap.** `runBuild` calls
   `buildSession` (which calls `BundleSession.make` and opens the built
   session's own `Scope`) before the `Ref.modify` that installs the
   result into `state.roots`/`state.folders`. `Effect.ensuring` on
   `runBuild` always reverts the folder's slot to `Unbuilt` and
   completes its `Building` deferred, but it never discards the `built`
   value itself. An interrupt between `buildSession` returning and the
   install `Ref.modify` running leaves that built session's scope open
   and unreachable from `state`.

## Symptom

None observed in practice. Both windows need a fiber interrupted at a
point only two things in this codebase reach:

- Window 1 needs an interrupt between two effects run back to back with
  nothing awaited in between; today only `Scope.close` at server
  shutdown interrupts fibers this deep, and shutdown is a process that
  is exiting anyway.
- Window 2 needs a request fiber interrupted at transport scope close
  specifically during its own build. `shutdown` cannot land here: it
  drains the notification queue first, so a queued `didOpen`'s build
  runs to completion (through `runBuild`'s own install) before shutdown
  proceeds to close the transport's scope.

If window 2 does trigger, the leaked value is an unclosed `Scope` with
no live session behind it and no fiber holding a reference once the
interrupted `runBuild` call unwinds -- ordinary garbage, not a resource
a client can observe leaking, since the process is exiting or the
folder simply reverts to `Unbuilt` and the next `sessionFor` call
rebuilds it from scratch.

## Why it is acceptable now

Both windows are exercised, if at all, only during the server's own
shutdown sequence -- a process about to exit, where an undisposed
session or an unclosed scope has no client-observable effect and is
reclaimed with the process. Closing either window costs a real
mechanism for a benefit that only exists in the shutdown path; phase
4's final review weighed that trade and chose to record the edges here
rather than add the mechanism against a symptom nothing currently
produces.

## The fix

Window 1: wrap the `Ref.modify` swap and the `disposeEntry` call in one
`Effect.uninterruptibleMask`, so an interrupt requested during the swap
is honored only after the old entry's dispose has run.

Window 2: track the in-flight `built` value the same way `runBuild`
already tracks the folder's `Building` deferred, and add it to the
`Effect.ensuring` finalizer so an interrupted build's scope is closed
(the same way a build that loses the install race today calls
`discard` on its `built` value at line 342) rather than left open.

## Links

- [LSP](../modules/lsp.md) -- the module this limitation bounds.

[^registry]: `../../packages/lsp/src/session/registry.ts`
