---
"@okfit/core": minor
---

## Breaking Changes

The `BodySha256` export is removed. Digests now live in an okfit-owned top-level `integrity` frontmatter family, modeled by the new `Integrity` and `Digest` exports.

Migrate imports of `BodySha256` to `Digest` (a 16-hex truncated SHA-256) and read generated digests from `integrity.generated.body` instead of `generated.body_sha256`.

## Features

* New `Integrity` frontmatter family holding `generated.body` and `verified { by, at, content }`
* New `verified-drift` lint, registered with a default severity of `warn`, for concepts edited after they were verified
