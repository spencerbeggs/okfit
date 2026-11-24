---
type: Decision
title: A verification is bound to the content it covered
description: okfit verify records a digest of the body plus authored frontmatter beside the verified entry, so a later edit is detectable as drift; drift never changes the trust tier, which only the spec's current-event rule moves.
tags:
  - architecture
  - docs
generated:
  by: okfit/claude-code
  at: 2026-11-24T05:58:20Z
status: stable
sources:
  - id: canonical-ts
    resource: ../../packages/profiles/src/Canonical.ts
integrity:
  generated:
    body: 465023c7007d2635
  verified:
    by: human:spencer
    at: 2026-10-25T18:29:21Z
    content: ca4e3d76881b58b9
verified:
  - by: human:spencer
    at: 2026-10-25T18:29:21Z
---

# A verification is bound to the content it covered

## Context

OKF v0.2 makes `verified` independent of the content: a `{ by, at }` entry
says someone confirmed the concept, not which text they read. Nothing
noticed when a verified concept changed afterwards, so the software-project
profile told agents never to edit a stable Decision, a rule standing in for
a missing check.

## Decision

Every write of a `verified` entry (`okfit verify`, batch, picker, `stale
--verify`, the language server's code action) also writes
`integrity.verified { by, at, content }` in the same edit; `by` and `at`
join to the entry. `content` is a 16-hex digest of canonical JSON over the
normalised body and the parsed authored frontmatter, minus the bookkeeping
keys `generated`, `verified`, `integrity`, `stale_after`, `status`, legacy
`timestamp` and each `renders[].body`. Parsed rather than source
frontmatter means quoting, key order and newline style never cause drift;
arrays keep their order. The encoder lives in `@okfit/profiles`, not core,
because binding content to verification is an okfit opinion the spec does
not hold.

The trust tier is the spec's. Under OKF v0.3 section 5.3 only current
verification events count: an event whose `at` is equal to or later than
`generated.at` (any event when `generated` or `generated.at` is absent). An
earlier event stays in the file as history and counts for nothing, so a
concept edited after its verification reads as a lower tier. That is the
spec's rule, applied to every bundle whatever it declares, and okfit's
integrity signal does not alter it.

Integrity is stricter than the tier. Profiles derives whether a binding is
still current from the bound digest, the current content, and whether the
bound entry is itself a current event by section 5.3. It reports drift with
the reasons `content-changed`, `unbound`, `entry-superseded`,
`actor-not-allowed` and `verified-before-change`, through the
`verified-drift` lint and verify's results and envelope; a bound entry dated
before the last change is `verified-before-change`, reported by core's lint
of the same name and not repeated by `verified-drift`. Machine entries
neither bind nor break a binding. Status changes do not void a verification.

Because integrity reads `current` only for a current bound entry, the skip
rule follows it: batch, the picker and the language server treat a
concept as already verified only when its binding is current. `okfit verify`
also refuses to write a verification that would not be current (`--at`
before `generated.at`, or a `generated.at` in the future), exit `3`, so it
never records an entry the next read would discard. `okfit sync` keeps the
usual edit, verify, commit sequence current by never stamping a
`generated.at` later than a human verification of exactly the current
content (see [Every okfit digest lives in one integrity
family](integrity-family.md)).

## Alternatives rejected

- Digest the body only. A verified `description` or `resource` could change
  without notice.
- Hash the frontmatter source text. Reformatting would read as a content
  change.
- Change the trust tier on drift. Drift is okfit's signal, so it never
  moves the tier: the spec's own rule does, and only from the specified
  fields (OKF section 11), so drift is reported beside the tier.

## Consequences

Any concept can be edited by anyone; the edit shows as drift until a human
re-runs `okfit verify`. A concept whose `generated.at` moved past its
verification also falls a tier, as the spec requires. Every entry written before the binding existed is
`unbound` drift, which surfaces a bundle-wide re-verify sweep. A human
re-verifying a drifted concept on an interactive terminal sees the git diff
since the bound verification first (`--no-diff` skips it), and `okfit verify
--revoke <id>` removes the current actor's own entries. The digest is a
signal, not tamper resistance. The format is in [integrity
frontmatter](../interfaces/integrity-frontmatter.md) and the family's
rationale in [integrity family](integrity-family.md).
