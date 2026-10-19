---
"@okfit/engine": patch
---

## Bug Fixes

* The overlay filesystem's `stat` for an unsaved editor buffer reports `dev` as a `bigint`, matching `FileSystem.File.Info` in effect 4.0.5.
