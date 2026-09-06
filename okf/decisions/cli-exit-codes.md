---
type: Decision
title: Exit codes are a fixed six-value total order
description: okfit's exit codes form one fixed, non-configurable total order from 0 to 130, where warnings and info never change the result.
tags:
  - architecture
generated:
  by: human:spencer
status: stable
---

# Exit codes are a fixed six-value total order

## Context

`okfit validate`/`init`/`context` all need one exit-code contract simple
enough for a shell script — this repo's CI step, the plugin's `PostToolUse`
hook — to branch on without parsing the JSON envelope.

## Decision

The total order is: `130` interrupt, `64` usage error, `3` infrastructure
failure, `2` one or more conformance diagnostics of severity error, `1` one
or more lint or profile diagnostics of severity error, `0` otherwise; higher
wins when several tiers apply; warnings and info never change the exit code;
profile diagnostics fold into tier 1
(ruling K-7).

## Alternatives rejected

A bitmask or a distinct code per diagnostic category would let a caller
distinguish "one lint error" from "one profile error", but every real
consumer of this exit code — a plain CI `run:` step, the plugin's hook —
only ever needs "did this pass, and if not, how badly", which a total order
already answers.

## Consequences

Task V2's CI step can rely on a plain non-zero exit failing the job with no
wrapper or `echo $?`; Task V3's verification gate additionally distinguishes
the ten `require-verified-unmet` lint warnings from a lint error precisely
because warnings are defined to never move the exit code off `0`.
