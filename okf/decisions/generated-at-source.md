---
type: Decision
title: Generated.at is the author date of the last commit that changed the body
description: Derivation computes generated.at as the author date of the newest commit whose blob changed the concept's body, never the stamp commit's date; sync stamps it, or the earlier binding.at of a verification of the same content.
tags:
  - architecture
generated:
  by: human:spencer
  at: 2026-11-28T00:16:02Z
status: stable
verified:
  - by: human:spencer
    at: 2026-09-07T20:49:08Z
  - by: human:spencer
    at: 2026-10-11T14:21:44Z
  - by: human:spencer
    at: 2026-11-24T06:53:02Z
  - by: human:spencer
    at: 2026-11-25T13:29:38Z
x-okfit-integrity:
  generated:
    body: 8465a96b9992695f
  verified:
    by: human:spencer
    at: 2026-11-25T13:29:38Z
    content: 208a23c5f8a7cc48
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

That is the derived instant. `okfit sync` stamps it as `generated.at`, except
that it stamps the earlier `binding.at` when a human verification of exactly
the current content is bound (see [Every okfit digest lives in one integrity
family](integrity-family.md)).

`okfit sync` also re-stamps a `generated.at` that is more than five minutes later than
now to now (whole seconds), even behind a matching digest, and clamps a drifted
concept's new stamp to now when the commit's author date is later than now (#471). That is the one exception to an authoritative stamp never
being rewritten: a stamp that far ahead comes from a skewed clock or a hand edit, no
verification can count against it (OKF v0.3 §5.3), and five minutes is the allowance
for ordinary clock skew. Sync never makes a verification count. When the re-stamp would make a verification
dated between now and the stamp current, sync leaves the stamp, reports the concept
as skipped (`verified-after-now`) and a human corrects `generated.at` or that
verification. When the clamp would, sync writes the derived stamp unclamped and
reports it `verified-after-now` on that run (#509); the lint `generated-at-future` also reports it once it is
more than five minutes ahead. A drifted
concept's new stamp is also never moved back below the stamp it replaces when a verification falls
between the two: the existing stamp is kept and the body digest is still re-recorded, and a kept stamp more than five
minutes ahead is reported `verified-after-now` on that run. A changed concept is still written, so it may be in both `written` and
`skipped`. A kept stamp more than five minutes ahead that guards no verification dated after now is
re-stamped to now on the same run, so "commit, then run okfit sync" converges in one run, even when the commit's
author date is older than a verification (amend, rebase, cherry-pick). A hold within the five-minute tolerance is not reported.
A clock that is far behind is not refused: sync keeps acting. Each run that selects the generated mode and sees a
`generated.at` or a commit's author date more than five minutes later than now prints one warning on stderr, naming
how many concepts and the latest time, and says the clock may be behind. Under `--format json` the envelope's optional
`clock_behind` key carries it and stderr stays empty. The exit code never changes.
This is the owner's ruling of 2026-11-25 on #509. The
owner accepted the cost: a concept whose repair is blocked has no okfit repair and
needs a human.

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
