---
"@okfit/engine": minor
---

## Features

- Add `FrontmatterEdits.verifiedWithStatus(source, entry, status)`, which appends a `verified` entry and sets `status` in a single edit set. Both changes land in one atomic edit, even when they insert at the same offset, so editors can verify a concept and mark it stable in one step.
