---
type: Decision
title: Every okfit digest lives in one integrity family, outside the spec's families
description: okfit stores its digests only under a top-level integrity key, so generated and verified stay exactly as OKF defines them and a digest is 16 hex characters of SHA-256.
tags:
  - architecture
  - docs
generated:
  by: okfit/claude-code
  at: 2026-11-24T06:04:04Z
status: stable
supersedes: profiles-body-sha256-detects-real-drift.md
sources:
  - id: integrity-ts
    resource: ../../packages/core/src/Integrity.ts
x-okfit-integrity:
  generated:
    body: d96fb1111c604cf9
  verified:
    by: human:spencer
    at: 2026-11-24T06:53:02Z
    content: 5076496d59064ff9
verified:
  - by: human:spencer
    at: 2026-10-25T18:29:21Z
  - by: human:spencer
    at: 2026-10-31T21:31:20Z
  - by: human:spencer
    at: 2026-11-24T06:53:02Z
---

# Every okfit digest lives in one integrity family, outside the spec's families

## Context

[A body digest inside generated](profiles-body-sha256-detects-real-drift.md)
put `body_sha256` inside the spec's `generated` block. It worked, but a
second digest was coming (the content a human verified, see [Verification
binds the content it covered](verification-binds-content.md)), and the
spec's `verified` entry is `{ by, at }` with nothing for a digest to
attach to. Putting okfit's own keys inside `generated` and `verified` would
leave both spec families carrying tooling state.

## Decision

okfit owns one top-level frontmatter key, `integrity`, and is the only
writer of digests into it. The contract is [integrity
frontmatter](../interfaces/integrity-frontmatter.md): `integrity.generated.body`
replaces `generated.body_sha256`, and `integrity.verified` binds one
`verified` entry to a content digest. `generated` and `verified` return to
pure spec shape; OKF v0.3 section 4.1 allows producers to add keys and asks
consumers to preserve them, so the family is conformant.

A digest is the first 16 lowercase hex characters (64 bits) of SHA-256,
computed through core's `Digest` service (`effect/crypto`). Core holds the schema and never
hashes. The old keys, `generated.body_sha256` and Publication
`renders[].body_sha256`, are legacy: `okfit sync` migrates them to
`integrity.generated.body` and `renders[].body` and reports them as
`migrated`.

`integrity` is a separate okfit signal beside the authoritative spec trust
tier, never a replacement for it: the tier comes from the spec's current
verification events (OKF v0.3 section 5.3), integrity from the bound digest.
`okfit sync` stamps `generated.at` as the derived instant (under `--staged`,
the hook's clock), except that it
stamps `min(derived instant, binding.at)` when `integrity.verified` binds the
latest human entry and covers exactly the current content. The binding proves
that content existed at `binding.at`, which makes that instant the content's
last meaningful change (section 5.2), and it keeps a verification current
across the edit, verify, commit sequence. The `[actors].humans` allow-list
does not gate the clamp, and a concept whose body digest is unchanged is
never rewritten.

## Alternatives rejected

- Keep digests inside `generated` and add a `verified` digest key. This
  mixes tooling state into the two families the spec defines, and an
  unknown key inside `verified` risks failing that family's decode and
  demoting the concept to unverified.
- A sidecar manifest of digests. It conflicts on every parallel branch, the
  reason the superseded Decision already rejected it.
- Full 64-character digests. Length buys no tamper resistance for a signal
  anyone who can edit a body can rewrite; 64 bits makes an accidental
  collision with a concept's own prior digest negligible.

## Consequences

The superseded Decision rejected a namespaced root because it split one
concern across two places. A single `integrity` home for every okfit digest
removes that split, so the rejection no longer applies. A malformed
`integrity` block fails only its own family, never `generated` or
`verified`. Existing `verified` entries have no binding until a human
re-verifies them, so they report as drifted (see [Drift is a signal, not a
gate](drift-is-a-signal.md)). Digests are written single-quoted when they
are all digits or digits-e-digits, because YAML would read them as numbers.
