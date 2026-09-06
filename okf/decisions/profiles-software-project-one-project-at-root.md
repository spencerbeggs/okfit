---
type: Decision
title: Exactly one Project concept, at the bundle root
description: The software-project profile requires exactly one Project concept and requires it to live at the bundle root, enforced as three non-configurable profile errors.
tags:
  - architecture
generated:
  by: human:spencer
status: stable
---

# Exactly one Project concept, at the bundle root

## Context

The `software-project` profile needs exactly one root concept describing the
whole repository, but nothing in core's schema-level type system enforces
cardinality or position for any concept type — that enforcement has to live
in the profile layer instead.

## Decision

Profiles owns a `Profile.check` function returning `ProfileDiagnostic`s with
codes `project-missing`, `project-multiple` (one per extra Project), and
`project-not-at-root`, all non-configurable `error` severity, checked
independently of each other
(ruling P-21;
implemented at `packages/profiles/src/SoftwareProject.ts:135-174` — two
Projects with one of them nested yields three diagnostics at once, not one).

## Alternatives rejected

Folding this into core's own `LintCode` table would give it a configurable
severity and would force every other profile, not only `software-project`,
to accept the same one-Project-at-root cardinality rule; P-21 reserves that
fold explicitly as a phase-2 option, not something this phase does.

## Consequences

This repo can never silently end up with zero or two `project.md` files and
still pass `okfit validate` clean; Task S1's scaffold step is the only place
`okf/project.md` is created, and this task's ten Decision concepts live only
under `okf/decisions/`, never at the bundle root, so they never trip
`project-not-at-root`.
