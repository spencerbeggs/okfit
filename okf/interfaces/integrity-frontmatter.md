---
type: Interface
title: integrity frontmatter family
description: The top-level integrity key okfit writes into a concept, its digest format, and how integrity.verified joins to a verified entry.
kind: config
resource: ../../packages/core/src/Integrity.ts
tags:
  - architecture
  - docs
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-11T03:57:51Z
sources:
  - id: integrity-ts
    resource: ../../packages/core/src/Integrity.ts
  - id: canonical-ts
    resource: ../../packages/profiles/src/Canonical.ts
integrity:
  generated:
    body: 12b8c9c215ea2ac8
---

# integrity frontmatter family

`integrity` is an okfit-owned top-level key, the only place okfit stores
digests. It is an OKF v0.2 section 4.1 extension key: other tools preserve
it. The rationale is in [Every okfit digest lives in one integrity
family](../decisions/integrity-family.md).

```yaml
integrity:
  generated: { body: 47fef58df84c6eb2 }
  verified: { by: human:spencer, at: 2026-10-10T18:00:00Z, content: 9a1c3f07b2e8d415 }
```

## Keys

- `integrity.generated.body` is the digest of the normalised body as of
  `generated.at`. `okfit sync` writes it, and the `generated-at-drift` lint
  and sync's `unchanged` check read it.
- `integrity.verified` binds one `verified` entry to the content it covered.
  `by` and `at` are the join key into `verified`; `content` is the content
  digest. `okfit verify` writes it in the same edit as the entry. Only a
  human run of `okfit verify` writes it.
- Both keys are optional, and `integrity` is omitted when empty.

## Digest format

A digest matches `^[0-9a-f]{16}$`: the first 16 lowercase hex characters
(64 bits) of SHA-256, a prefix of the full digest. It is written
single-quoted when it is all digits or digits-e-digits, since YAML would
otherwise read a number. Body input is the body with CRLF and lone CR
folded to LF and trailing whitespace trimmed. Content input is canonical
JSON of the normalised body and the parsed authored frontmatter, with keys
sorted by code point and arrays kept in order, minus `generated`,
`verified`, `integrity`, `stale_after`, `status`, legacy `timestamp` and
each `renders[].body` (see [Verification binds the content it
covered](../decisions/verification-binds-content.md)).

## Legacy keys and failure behaviour

`generated.body_sha256` and Publication `renders[].body_sha256` are legacy.
Core still decodes the former leniently as a migration fallback; `okfit
sync` rewrites both and reports `migrated`. A malformed `integrity` block
yields `family-invalid` for `integrity` only and leaves `generated` and
`verified` intact. A digest is a signal, not tamper resistance.
