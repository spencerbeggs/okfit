---
"@okfit/engine": minor
---

## Breaking Changes

`run`, `runSync`, the move, trust and validate programs, and `BundleSessionServices` now require `Digest.Digest` (from `effect/crypto`) instead of `Crypto.Crypto`, which Effect 4.1 removed. `OkfitPlatform` now provides `Digest` itself (via `NodeCrypto.layerDigest`), because `NodeServices.layer` no longer carries crypto. If you compose your own layers rather than using `OkfitPlatform`, add `NodeCrypto.layerDigest` from `@effect/platform-node`. Digests are byte-identical to before.

## Bug Fixes

* The overlay filesystem (`makeOverlayFileSystem` / `layerOverlayFileSystem`) now shadows Effect 4.1's `readDirectoryEntries`, so unsaved open documents are listed as `File` entries in directory reads.
