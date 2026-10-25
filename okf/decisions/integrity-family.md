---
type: Decision
title: Every okfit digest lives in one integrity family, outside the spec's families
description: okfit stores its digests only under a top-level integrity key, so generated and verified stay exactly as OKF v0.2 defines them and a digest is 16 hex characters of SHA-256.
tags:
  - architecture
  - docs
generated:
  by: okfit/claude-code
  at: 2026-10-11T03:57:51Z
status: stable
supersedes: profiles-body-sha256-detects-real-drift.md
sources:
  - id: integrity-ts
    resource: ../../packages/core/src/Integrity.ts
integrity:
  generated:
    body: 565cf7625b3b1fb7
  verified:
    by: human:spencer
    at: 2026-10-25T18:29:21Z
    content: 4d20e30f9a1f1b1f
verified:
  - by: human:spencer
    at: 2026-10-25T18:29:21Z
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
pure spec shape; OKF v0.2 section 4.1 allows producers to add keys and asks
consumers to preserve them, so the family is conformant.

A digest is the first 16 lowercase hex characters (64 bits) of SHA-256,
computed through effect's `Crypto` service. Core holds the schema and never
hashes. The old keys, `generated.body_sha256` and Publication
`renders[].body_sha256`, are legacy: `okfit sync` migrates them to
`integrity.generated.body` and `renders[].body` and reports them as
`migrated`.

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
