---
type: Decision
title: Uncommitted provenance is the caller's to interpret
description: Derivation reports an uncommitted body's provenance without ever substituting the current time, leaving the interpretation to the caller.
tags:
  - architecture
generated:
  by: human:spencer
status: stable
verified:
  - by: human:spencer
    at: 2026-09-07T20:49:09Z
---

# Uncommitted provenance is the caller's to interpret

## Context

A concept's on-disk body can differ from its most recent commit at the exact
moment `generated.at` is computed — the file may be dirty, untracked, or sit
on an unborn HEAD — and derivation had to decide what value to hand back in
each case.

## Decision

`Derivation.generatedAt` returns a tagged union, `BodyProvenance` —
`committed { at, sha, committedAt, authorName, authorEmail }` or
`uncommitted { reason: untracked | dirty | unborn }`
(ruling P-9) — and
never substitutes `now` for the uncommitted case; it only ever reports what
it found (ruling
P-10). The recommended caller policy, documented in the profiles README, is
to omit `generated.at` entirely until the body is committed; `okfit init`'s
own `project.md` scaffold already follows this, writing no `generated` block
at all.

## Alternatives rejected

Falling back to the current wall-clock time for an uncommitted body would
fabricate a provenance stamp for content with no commit backing it yet —
exactly the self-reported-timestamp failure mode the design spec's
provenance model exists to rule out, and indistinguishable from a real value
to anything downstream that reads it.

## Consequences

Every one of this plan's concepts, including these ten Decisions, carries no
`generated.at` key at all while its body is uncommitted (F-9); once a
concept's body is committed, a future phase-2 tool can compute and add the
real value from git history — never a hand-typed guess.
