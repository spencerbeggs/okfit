---
type: Decision
title: A verification is bound to the content it covered
description: okfit verify records a digest of the body plus authored frontmatter beside the verified entry, so a later edit is detectable as drift while the spec's trust tier stays unchanged.
tags:
  - architecture
  - docs
generated:
  by: okfit/claude-code
  at: 2026-10-11T03:57:51Z
status: draft
sources:
  - id: canonical-ts
    resource: ../../packages/profiles/src/Canonical.ts
  - id: design-spec
    resource: ../../docs/superpowers/specs/2026-10-10-okfit-verification-integrity-design.md
integrity:
  generated:
    body: 58ef6210048cb568
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

A derived signal answers how much to value a concept: the spec trust tier
(unchanged) plus `integrity` of `current`, `drifted` or `none`, with a drift
reason (`content-changed`, `unbound`, `entry-superseded`,
`actor-not-allowed`) and staleness. Machine entries neither bind nor break
a binding. Status changes do not void a verification.

## Alternatives rejected

- Digest the body only. A verified `description` or `resource` could change
  without notice.
- Hash the frontmatter source text. Reformatting would read as a content
  change.
- Change the trust tier on drift. OKF section 11 says consumers derive
  tiers only from the specified fields, so drift is reported beside the
  tier.

## Consequences

Any concept can be edited by anyone; the edit shows as drift until a human
re-runs `okfit verify`. Every entry written before the binding existed is
`unbound` drift, which surfaces a bundle-wide re-verify sweep. A human
re-verifying a drifted concept on an interactive terminal sees the git diff
since the bound verification first (`--no-diff` skips it), and `okfit verify
--revoke <id>` removes the current actor's own entries. The digest is a
signal, not tamper resistance. The format is in [integrity
frontmatter](../interfaces/integrity-frontmatter.md) and the family's
rationale in [integrity family](integrity-family.md).
