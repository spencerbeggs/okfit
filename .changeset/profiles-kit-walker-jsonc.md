---
"@okfit/profiles": minor
---

## Breaking Changes

`@okfit/profiles` now declares `@effected/walker`, `@effected/jsonc` and `@effected/glob` as peer dependencies. `Derivation.worktreeRoot` walks upward with `@effected/walker`, and the body and content digests hash through `@effected/jsonc`'s `JsoncFingerprint.hashText`. Install the three alongside `@okfit/profiles` if your project does not already have them; anything that also uses `@okfit/core` already does, since core requires all three. Digests are byte-identical to the previous release, so stamped `integrity` values stay valid.
