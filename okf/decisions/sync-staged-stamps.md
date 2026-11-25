---
type: Decision
title: okfit sync --staged stamps the git index with now, the one place a wall-clock stamp is honest
description: Inside a pre-commit hook the current instant is the commit's author date to within seconds, so --staged stamps staged concepts with now and their digest; the default sync still never substitutes now.
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-11-25T04:25:12Z
status: stable
verified:
  - by: human:spencer
    at: 2026-10-05T22:56:15Z
  - by: human:spencer
    at: 2026-10-11T14:21:44Z
  - by: human:spencer
    at: 2026-10-11T22:01:13Z
  - by: human:spencer
    at: 2026-10-25T18:29:21Z
  - by: human:spencer
    at: 2026-11-23T22:13:15Z
  - by: human:spencer
    at: 2026-11-24T06:53:02Z
  - by: human:spencer
    at: 2026-11-24T22:21:07Z
x-okfit-integrity:
  generated:
    body: d385a617f9f08a15
  verified:
    by: human:spencer
    at: 2026-11-24T22:21:07Z
    content: d623629fddc1d4f3
---

# okfit sync --staged stamps the git index with now, the one place a wall-clock stamp is honest

## Context

`generated.at` is derived from the commit that introduced the body, so a
new or body-edited concept could only be stamped after it was committed,
and the stamp then needed a second commit (okfit #20). Derivation's rule
that an uncommitted body never gets `now` substituted for its provenance
([Uncommitted provenance is the caller's to
interpret](uncommitted-provenance.md)) is correct
for an ordinary run: a file staged today may be committed next week.

## Decision

`okfit sync --staged` is a caller policy layered on top of that rule, not
a change to it. It selects only the concepts in the git index, stamps
`generated.at` with the current instant (truncated to seconds), or the earlier
`binding.at` when a human verification of exactly the current content is
bound and `binding.at` is not earlier than the concept's existing
`generated.at`, so a revert to earlier verified content never moves the stamp
backwards (see [Every okfit digest lives in one integrity
family](integrity-family.md)), and
`x-okfit-integrity.generated.body` with the body's 16-hex digest, writes, and re-adds what
it wrote so the stamp lands in the same commit. It never walks history. A staged concept whose `generated.at` is more than five
minutes later than now is re-stamped to the hook's instant even when its digest
matches, and an unstaged one is left alone (#471, see [Generated.at is the author
date of the last commit that changed the body](generated-at-source.md)).
Its log mode (#295) writes the commit's own `log.md` entry from the same
facts: the group date is the hook's instant, which is the author date a
post-commit walk would derive a moment later. It equals the `generated.at`
stamp except when that stamp was clamped to the earlier `binding.at`, in which
case the two differ; the verb is `Added` for a
path HEAD lacks and `Updated` otherwise; the text is the concept's title.
A later ordinary sync finds that entry already named and leaves the log
`unchanged`. A `log.md` with unstaged edits is skipped as `dirty`, since
re-adding it would commit a human's unstaged work. It is
meant to be run from a pre-commit hook and nowhere else; outside one it is
the very fabrication the Derivation rule forbids, which is why it stays
behind an explicit flag and the default behaviour is untouched.

## Alternatives rejected

A post-commit hook still needs a second commit for the stamp. Deriving
the author date from `GIT_AUTHOR_DATE` was deferred: the hook use case
does not set it, and `OKFIT_NOW` already provides a deterministic override.

## Consequences

A concept still carrying the legacy `generated.body_sha256` is migrated to
`x-okfit-integrity.generated.body` by the same staged run (see [integrity
frontmatter](../interfaces/integrity-frontmatter.md) and
[okfit's keys carry the x-okfit- prefix](okfit-keys-carry-x-okfit-prefix.md)); the hook never
writes `x-okfit-integrity.verified`.

The digest guarantees a `--staged` stamp is never rewritten by a later
walk. An aborted commit leaves a stamp, and a log entry, a few seconds early,
harmlessly; re-running the hook for an amend adds no second entry.
`--staged` stages the whole file, so a partially staged concept
(`git add -p`) is fully staged by it. savvy-web/systems#657 carries the
husky side: skip in CI, skip without `okfit` on PATH, fail the commit on
a non-zero exit. Index mode under `--staged` lists only concepts in the git index,
with their indexed titles and descriptions: an untracked concept, or one
removed with `git rm --cached`, is absent, and a tracked concept with unstaged
edits renders its indexed text (#142).
