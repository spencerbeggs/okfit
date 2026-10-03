---
"@okfit/engine": minor
---

## Features

- Add `stampPublication`, which re-stamps one Publication's `renders` digests so a re-rendered page stops reporting `publication-drift`. `FrontmatterEdits` gains a `rendersDigests` edit to carry the new digests.
- Add `PublicationNotFoundError`, `NotAPublicationError`, and `SyncPublicationConflictError`; all map to exit code 64.
- The sync JSON envelope gains an optional `publication` member naming the page that was restamped.
