---
"@okfit/cli": minor
---

## Breaking Changes

The `okfit sync` and `okfit verify` JSON envelopes changed: sync output gains `migrated`, and verify output reflects the integrity binding. Digests are 16 hex characters and legacy `body_sha256` fields are migrated by `okfit sync`.

## Features

### Verification binds content

`okfit verify` records `integrity.verified { by, at, content }`, a digest of the body plus authored frontmatter. Editing a verified concept afterwards raises the `verified-drift` lint (default `warn`); batch verify and the picker offer drifted concepts again.

### Revoke

`okfit verify --revoke <id>` removes your verification from a concept.

### Review drift before re-verifying

`okfit verify <id>` on a drifted concept shows the git diff since it was verified and asks you to confirm. Pass `--no-diff` to skip the diff.
