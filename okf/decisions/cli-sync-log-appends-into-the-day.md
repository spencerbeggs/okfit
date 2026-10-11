---
type: Decision
title: okfit sync's log mode appends into the newest logged day and dedupes on its own spellings
description: Log mode adds items for every committed concept dated on or after the newest logged date, appending into that day's existing group when no mechanical item already names the concept; --since widens the floor on request.
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-10-11T14:44:29Z
status: stable
verified:
  - by: human:spencer
    at: 2026-09-24T00:20:55.156Z
  - by: human:spencer
    at: 2026-10-11T14:21:44Z
  - by: human:spencer
    at: 2026-10-11T15:55:11Z
integrity:
  generated:
    body: 4612515e53ba8761
  verified:
    by: human:spencer
    at: 2026-10-11T15:55:11Z
    content: 3b405fdc7c7ae8f1
---

# okfit sync's log mode appends into the newest logged day and dedupes on its own spellings

## Context

An earlier rule only added items for dates strictly after the newest
`## YYYY-MM-DD` group, so a concept committed on a day that already had a
group -- the common case, since `okfit init` writes the day's group and the
first concepts land the same day -- was never logged at all (issue #18).
That rule existed because `log.md` is reserved and derived yet also
curated, hand-editable history, so regenerating it wholesale from git
history would discard hand-written refinements. The protection was
stronger than that guarantee needed: `mergeLog` already appends new
items after an existing group's verbatim text without touching a byte of
it, so the protection was stronger than the guarantee needed.

## Decision

Log mode's window is inclusive of the newest logged date. For each
committed concept dated on or after that floor, the item is added unless
the group for that date already holds an item whose text is exactly
`Added <title>` or `Updated <title>` -- the two spellings `sync` itself
writes. Hand-written prose is never parsed or compared. `okfit sync
--since <YYYY-MM-DD>` replaces the default floor with an explicit one, for
back-filling an older range on purpose. Existing groups keep every byte
they had; new items are appended after the last existing item.

## Alternatives rejected

Keeping the strictly-after rule and asking the finalize skill to
hand-write the missing line was rejected because it made the most common
migration shape (init and first concepts on one day) silently unlogged.
Deduplicating against prose by fuzzy match was rejected because it
would require log mode to parse prose it did not write, a comparison
with no reliable answer.

## Consequences

A same-day concept now gets its `Added` line on the next `sync`. A human
who wrote "Added Foo" by hand in the mechanical spelling suppresses the
mechanical line; one who described it in other words gets both, which is
the documented price of never reading prose. `--since` is the only way to
reach back past the newest logged date.
