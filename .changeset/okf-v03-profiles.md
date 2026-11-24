---
"@okfit/profiles": minor
---

## Breaking Changes

`ConceptSignal` gains a required `staleness` field. Code that constructs a `ConceptSignal` must now supply it.

## Features

- `Publications.resolveRef` resolves a leading `/` from the bundle root, strips `#` and `?` suffixes and percent-decodes the reference.
- The Decision type's guidance names `superseded_by` and `supersedes`.

## Bug Fixes

- `verified-drift` skips a concept whose status is outside the vocabulary.
