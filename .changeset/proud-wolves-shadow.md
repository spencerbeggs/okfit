---
"@okfit/engine": minor
---

## Breaking Changes

`run`, `runSync`, the move, trust and validate programs, and `BundleSessionServices` now require `Digest.Digest` (from `effect/crypto`) instead of `Crypto.Crypto`, which Effect 4.1 removed. `OkfitPlatform` now provides `Digest` itself (via `NodeCrypto.layerDigest`), because `NodeServices.layer` no longer carries crypto. If you compose your own layers rather than using `OkfitPlatform`, add `NodeCrypto.layerDigest` from `@effect/platform-node`. Digests are byte-identical to before.

## Bug Fixes

* The overlay filesystem (`makeOverlayFileSystem` / `layerOverlayFileSystem`) now shadows Effect 4.1's `readDirectoryEntries`, so unsaved open documents are listed as `File` entries in directory reads.
* `changeSince` (the `okfit verify` change preview) reads its patch through `@effected/git`'s `Git.diffFile`, which pins colour, prefixes, context and algorithm, so user diff config no longer changes the preview. It no longer requires `ChildProcessSpawner`; every diff failure still surfaces as `GitCommandError`.
* `planMove` places a destination through `@effected/walker`'s `relativeWithin`. A destination whose containment cannot be proved (for example a permission error while resolving it) is now refused as `outside-bundle` instead of being resolved lexically.
* `okfit verify` refuses a concept whose content cannot be hashed (a frontmatter value holding an unpaired surrogate) with the new `VerifyContentUnhashableError` (exit 3), naming the field. Nothing is written.
