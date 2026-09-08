---
type: Decision
title: Generated.at is the author date of the last commit that changed the body
description: generated.at is computed as the author date of the newest commit whose blob changed the concept's body, never the stamp commit's date.
tags:
  - architecture
generated:
  by: human:spencer
  at: 2026-09-06T11:25:53Z
status: stable
verified:
  - by: human:spencer
    at: 2026-09-07T20:49:08Z
---

# Generated.at is the author date of the last commit that changed the body

## Context

`generated.at` is meant to answer "when did this concept's body last
meaningfully change"; the cheap, naive answer — the date of the most recent
commit that touched the file at all — is wrong the moment that commit only
edited frontmatter (a "stamp commit" bumping `stale_after` or a tag, say)
without touching the body.

## Decision

The algorithm walks the path's git history newest-first and compares each
entry's body against the previous entry's body until they differ (DERIVE
option C); the naive `git log -1 -- path` is never used because it returns
the stamp commit, not the body-change commit
(ruling P-2). The
value taken is the author date (`%aI`), not the committer date; the
committer date is still carried on the returned entry for callers that want
it (ruling P-4).

## Alternatives rejected

`git log -1`'s date is one command and no history walk, but it silently
reports the wrong instant for any file ever touched by a stamp-only commit;
using the committer date instead of the author date would report when a
commit was mechanically applied (for instance, after a rebase long after it
was written) rather than when the content was actually authored.

## Consequences

Every provenance lookup costs up to one `Git.show` per historical blob until
the bodies diverge, an accepted phase-1 cost with no batch entry point
reserved (ruling
P-8); in exchange, the value stays correct across rebases and
frontmatter-only edits, which a one-commit lookup cannot guarantee.
