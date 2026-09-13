---
type: Decision
title: The software-project vocabulary grows a second time from the effected and tsdoctor migrations
description: Three types (Consumer, Roadmap, Measurement) and three tags (bundle, observability, deps) were added to the software-project profile because two further migrations had to add the same repo-local extensions to express downstream scope, queued work, and empirical evidence.
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-13T16:30:00Z
status: draft
---

# The software-project vocabulary grows a second time from the effected and tsdoctor migrations

## Context

[The first growth round](profiles-vocabulary-grows-from-dogfood.md)
took the profile from six types to eleven on the evidence of three
migrations. Two more (spencerbeggs/effected at 268 concepts and
spencerbeggs/tsdoctor at 28 design docs) then filed
[#76](https://github.com/spencerbeggs/okfit/issues/76) through
[#81](https://github.com/spencerbeggs/okfit/issues/81) with the same
shape of finding: a downstream repository that closes the scope of a
library had no type and was written as a repo-local `Consumer`; a phased
roadmap with gates squeezed into a `Decision` with `status: draft` even
though nothing had been decided; a benchmark write-up that justified a
Decision lived as prose inside it, so a reader could not ask "what has
been measured" and the numbers could not rot on their own schedule; and
three cross-cutting concerns (install weight, self-reporting, and how
dependencies are declared and pinned) had no tag, so `performance` was
carrying install cost alongside runtime cost.

## Decision

- **Three new types**, each with a layout directory: `Consumer`
  (`repository` required, free text, since it lives outside this
  repository), `Roadmap` (an optional free-text `gate`; deprecate when the
  gate holds and write the resulting Decisions), and `Measurement` (an
  optional path-kind `justifies` naming the Decisions it supports).
- **Roadmap is not a Decision.** A draft Decision that decides nothing is
  the tell; a Roadmap carries intent with a `stale_after` so queued work
  is re-examined rather than read as settled.
- **Measurement is named for what it is.** `Finding` was considered and
  rejected because the dogfood and review loops already use "findings"
  for something else.
- **Three new tags**: `bundle`, `observability`, `deps`.
- **Dependency policy is a tag, not a type.** Each rule reads well as a
  `Convention` or a `Runbook`; the only loss was queryability, which the
  `deps` tag restores at no cost.

## Alternatives rejected

- **Leave the extensions repo-local.** Both migrations reached the same
  types independently, which is the signal the first round treated as
  sufficient.
- **A `DependencyPolicy` type.** Heavier than the loss it repairs, and it
  would pull rules out of `Convention` where the staleness cadence already
  serves them.
- **Fold `bundle` into `performance`.** That conflation was the complaint.

## Consequences

- `okfit init` now scaffolds thirteen directories. Existing bundles are
  untouched; the new types are available, not required.
- The vocabulary moves together in the same four places as before: the
  profile source, `packages/profiles/README.md`'s TOML fence, the
  `okf-config` skill, the clean fixture bundle, and the `okfit-migrate`
  mapping table.
