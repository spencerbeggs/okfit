---
type: Decision
title: okfit sync's log mode appends by date and never rewrites existing prose
description: Log mode only adds items for dates after the newest logged date, leaving every existing group and hand-written item byte-identical.
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-08T14:33:59Z
status: stable
verified:
  - by: human:spencer
    at: 2026-09-08T13:12:41Z
---

# okfit sync's log mode appends by date and never rewrites existing prose

## Context

`log.md` is a reserved, derived file — no one should hand-regenerate it
wholesale — but it is also curated, hand-editable history: contributors
write and refine the prose under a date heading, and that prose is not a
mechanically-owned ledger `sync` is free to replace. Log mode needed a
rule for what "regenerate" means for a file that is both reserved and
hand-authored.

## Decision

Log ownership: curated prose is kept, and `sync` only appends. Log mode
finds the newest date already logged, then adds one `Added`/`Updated`
item per committed concept newer than that date, grouping new items by
date and merging the new groups with the existing ones verbatim. There is
no dedup against hand-written prose, and a concept committed on a day
that already has a hand-written group is never appended to that day's
group — that day's group is left exactly as written.

## Alternatives rejected

Regenerating `log.md` wholesale from git history on every `sync` run was
rejected because it would discard every hand-written refinement to a
group's prose, treating a curated history file as if it were as
mechanically owned as `index.md`.

Deduplicating new items against existing hand-written entries was
rejected because it would require log mode to parse and understand
prose it did not write, on the chance a human already described the same
change in different words — a comparison with no reliable answer.

Appending to an existing day's group when a new concept lands on that
same day was rejected because it would mean `sync` edits a byte range a
human has already written into, contradicting the "leaves every existing
group... byte-identical" guarantee this decision exists to make.

## Consequences

A concept committed on a date that already has a hand-written log group
gets no automatic log entry for that date; a human notices and adds it by
hand, or it is picked up the next time that date is the newest logged
date's successor. `sync --dry-run --only log` is safe to preview
repeatedly without ever risking a rewrite of prose a contributor already
wrote.
