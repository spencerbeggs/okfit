---
"@okfit/cli": minor
---

## Breaking Changes

The JSON output of three commands changed:

* `okfit sync --format json` mode results gain a `migrated` id list.
* `okfit sync --publication --format json` renames `digests[].body_sha256` to `digests[].body`, a 16-hex digest. Scripts reading the old key must read `body`.
* `okfit verify --format json` gains an optional `prior_integrity` field when the concept's prior human verification had drifted.

Digests are 16 hex characters, and `okfit sync` migrates legacy `body_sha256` fields to the `integrity` family.

## Features

### Verification binds content

`okfit verify` records `integrity.verified { by, at, content }`, a digest of the body plus authored frontmatter. Editing a verified concept afterwards raises the `verified-drift` lint (default `warn`); batch verify and the picker offer drifted concepts again.

### Revoke

`okfit verify --revoke <id>` removes your verification from a concept. With `--format json` it prints a new envelope: `id`, `path`, `revoked_by`, `removed` (the timestamps removed), `binding_cleared` and `dry_run`.

### Review drift before re-verifying

On an interactive terminal, `okfit verify <id>` on a drifted concept shows the git diff since its last verification and asks you to confirm. Pass `--no-diff` to skip the diff and the prompt. When you had verified the concept before, the output opens with `re-verifying (was drifted: <reason>)`.
