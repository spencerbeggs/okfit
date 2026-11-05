---
"@okfit/engine": minor
"@okfit/cli": minor
---

## Breaking Changes

`okfit sync`, `okfit verify` and `okfit mv` now refuse a concept file without write permission and leave it untouched. They used to replace a read-only file anyway, because the write went through a temp file and a rename.

To keep writing to such a file, restore its write permission with `chmod u+w <file>` first.

## Bug Fixes

* `okfit verify` no longer leaves a stray temp file behind when writing a concept fails partway, and two concurrent runs no longer share one temp file name
