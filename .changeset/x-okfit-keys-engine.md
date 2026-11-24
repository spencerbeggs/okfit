---
"@okfit/engine": minor
---

## Breaking Changes

okfit's frontmatter keys now carry the `x-okfit-` prefix, and the engine moves old bundles forward.

- `sync` renames the old keys in place: the `integrity` block becomes `x-okfit-integrity`, and each built-in profile field becomes its prefixed key, but only where the merged config declares the prefixed field for that concept's type and not the bare one. Quote style, values, comments and order are kept, the ids are reported as `migrated`, and a second run changes nothing.
- A concept that sync cannot stamp (uncommitted edits, untracked, no `generated` block) is still renamed, so an id can appear in both `migrated` and `skipped`.
- `SkipReason` gains `legacy-key-conflict` (a concept has both spellings of a key; nothing is written) and `legacy-key-unsupported` (the key cannot be renamed in place, for example a flow-style document or a duplicated key). An exhaustive `switch` over skip reasons must handle both.
- `VerifyUnsupportedFrontmatterError.key` is now `"x-okfit-integrity"` rather than `"integrity"`, and its `shape` gains `legacy-key`, raised when verify meets a concept that still carries the old block.
- `FrontmatterEdits.rendersDigests` takes the key spelling to edit, defaulting to `x-okfit-renders`.
- The migration fix refuses a concept that still uses the old keys and says to run `okfit sync` first; the other fixes still apply.

Run `okfit sync` once per bundle. The content digest now excludes `x-okfit-integrity`, so renaming `integrity` loses no verification; renaming a profile key changes the digest, so a verified concept with a profile field needs `okfit verify` again.
