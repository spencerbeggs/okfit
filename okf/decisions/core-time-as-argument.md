---
type: Decision
title: Time is an explicit argument, never a Clock service
description: Core takes now as an explicit DateTime.Utc argument everywhere staleness matters, and never depends on an Effect Clock service.
tags:
  - architecture
generated:
  by: human:spencer
status: stable
---

# Time is an explicit argument, never a Clock service

## Context

Staleness (`stale_after` vs. "now") needs a current instant somewhere in
core's pure derivation and lint layer, and core had to decide between the
idiomatic Effect `Clock` service and a plain function argument.

## Decision

Time is an argument: `Derive.staleness(concept, now: DateTime.Utc)`, with no
`Clock` service anywhere in core
(ruling D-10).

## Alternatives rejected

A `Clock`-based design would make every pure staleness/lint computation
effectful and require a `TestClock` layer in every unit test for no
behavioral gain; the lint layer already treats supplying "now" as optional
per call (`Validate.lint(bundle, config, options?: { now?: DateTime.Utc })`),
and the `stale` rule "fires only when `now` is supplied"
(ruling D-34) — a `Clock`
dependency would not make that any more correct, only more ceremonial.

## Consequences

Every caller — the CLI's `bin.ts`, a future Action, or a direct
`@okfit/core` test — supplies its own `now`, so time never becomes an
implicit ambient global; the `stale` lint diagnostic simply never fires when
a caller omits `now`, a deliberate, documented behavior rather than a bug.
