---
"@okfit/engine": minor
---

## Features

- `okfit sync --only generated` (and full `okfit sync`) now leaves a
  concept's `generated.at` untouched when its recorded
  `generated.body_sha256` still matches the current body — this is what
  stops a restamp commit after every squash or rebase merge (issue #19).
  Any other case (no recorded digest, or a mismatched one) writes both
  `generated.at` and `generated.body_sha256` together.
- `okfit verify`'s locate/splice pass generalized to handle both
  `generated.at` and `generated.body_sha256`: when a concept needs both
  fields freshly stamped at the same insertion point, the two edits merge
  into one rather than producing the "overlapping edits" case
  `MarkdownEdit.applyAll` treats as a programmer error.
- `okfit validate --skip-provenance` now narrows to skip only the
  git-derived fallback tier of the `generated-at-drift` lint (the
  date comparison used for a concept with no recorded
  `generated.body_sha256`). The pure, in-memory digest comparison still
  runs and still reports drift for a migrated concept even with the flag
  set — this is what lets an edit-time `validate` stay git-free while
  still catching an edited-but-unstamped body. Previously the flag
  dropped the `generated-at-drift` lint entirely.

## Breaking Changes

- `validate/run.ts#run`'s requirements channel now includes
  `Crypto.Crypto`, alongside the existing `FileSystem.FileSystem |
  Path.Path | Git | GitHistory`. A caller providing `NodeServices.layer`
  or `OkfitPlatform` (as `@okfit/mcp`'s `validateBundle.ts` and the CLI's
  `commands/validate.ts` already do) needs no change; only a caller
  assembling a narrower custom layer for `run` directly must add
  `Crypto.Crypto` to it.
