---
"@okfit/engine": minor
---

## Breaking Changes

The sync and verify JSON envelopes changed: sync output gains `migrated`, and verify reports the new integrity binding and revocation results. Consumers of the JSON envelopes should re-check the fields they read.

## Features

* `okfit sync` stamps `integrity.generated.body` and migrates legacy `generated.body_sha256` and Publication `renders[].body_sha256` digests to the new family, counting migrated concepts
* Verify binds `integrity.verified { by, at, content }` to a digest of body plus authored frontmatter
* Batch verify and the picker re-offer concepts that drifted since verification
* New revoke operation removes the current actor's verification
* New diff operation shows the git diff since a concept was last verified
