---
name: okf-context
description: >-
  CLAUDE.md as a thin router into the okf/ bundle, checked against index.md.
  Use when writing or auditing a CLAUDE.md pointer into the bundle, or when
  okf-finalize's branch-end sweep needs to verify pointer coverage. Trigger
  phrases -- "does this CLAUDE.md pointer still work", "check CLAUDE.md
  against the bundle", "should this go in CLAUDE.md or the bundle".
allowed-tools: Read, Grep
---

# okf-context

## The router rule

`CLAUDE.md` orients an agent at session start; it is not the deep
documentation itself. Every token loaded unconditionally costs the same
whether or not the agent needs it this session, so `CLAUDE.md` should point
into the `okf/` bundle -- naming a concept file and what it covers -- rather
than restating that concept's body inline. If a paragraph of `CLAUDE.md`
duplicates what a bundle concept already says, replace it with a pointer.

## The checklist

Run by hand as a step of `okf-finalize`, in both directions:

1. Every bundle path a `CLAUDE.md` names must appear somewhere in
   `index.md`. A pointer to a concept `index.md` does not list is a pointer
   to a file the bundle itself does not consider indexed -- either add it
   to `index.md` or fix the pointer.
2. Every top-level `index.md` section should be reachable from some
   `CLAUDE.md`. A section nothing points to is knowledge an agent will
   never be routed to at session start.

## When this runs

Plainly: there is no automated pointer-drift mechanism in phase 1. This
checklist is a step of `okf-finalize`, run once per branch-end sweep, not a
standing hook. design-docs' own `refs.json` hash-and-record pattern is the
counter-example worth naming: the field study found it rots without
enforcement, so it is deliberately not carried over here rather than
half-adopted. An MCP tool may automate this checklist in phase 2.

## What this does NOT do

It does not check the bundle's own conformance -- that is `okfit
validate`'s job and the `PostToolUse` hook's. This skill only checks
`CLAUDE.md`-to-`index.md` pointer coverage.
