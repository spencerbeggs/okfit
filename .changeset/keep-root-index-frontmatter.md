---
"@okfit/engine": minor
---

## Features

- `okfit sync` keeps a root `index.md`'s existing frontmatter and only writes `okf_version` when the block declares none.
- `ConceptSummary.status` may be `unknown` for a concept whose status is outside the known vocabulary.

## Bug Fixes

- Resource findings are ranged correctly after an ignored `sources` entry.
