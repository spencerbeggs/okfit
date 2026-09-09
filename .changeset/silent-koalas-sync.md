---
"@okfit/core": minor
---

## Features

- `Generated` gained an optional `body_sha256` key, validated by a new
  `BodySha256` schema (a lowercase 64-character hex sha256). Core only
  holds the field — it never computes a digest itself, since hashing needs
  a capability core's no-Node-imports rule keeps out of this package.
  `@okfit/profiles`' `Derivation.bodyDigest` is what computes it, and
  `okfit sync` is what writes it.

## Bug Fixes

- `lint.generated_at_drift`'s default severity moved from `info` to `warn`
  (issue #19). A `generated.at` that no longer matches its last
  body-changing commit is a real signal once a bundle records
  `generated.body_sha256` — squash and rebase merges can no longer silence
  it by rewriting commit dates — so the published config schema
  (`schemas/config/okfit-1.0.0.json`) now documents `"warn"` as the
  default too.
