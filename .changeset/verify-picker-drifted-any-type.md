---
"@okfit/engine": patch
"@okfit/cli": patch
---

## Bug Fixes

- The interactive `okfit verify` picker now offers every drifted concept, whatever its type, alongside the unattested concepts of `require_verified` types. Before, a drifted Interface, Module or other non-required type got a `verified-drift` warning telling you to re-run `okfit verify`, but the picker never listed it. A concept of such a type that nobody has verified is still left out.
- `okfit verify --all` takes the same drifted concepts of any type. With `--type`, it still takes exactly the named types.
