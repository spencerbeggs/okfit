---
"@okfit/engine": patch
---

## Bug Fixes

* `FrontmatterEdits.rendersDigests` writes the digest as the value of a bare `body:` or a `body: !!null` in a `renders` entry, instead of adding a second `body:` line (or, for a tagged null, a digest in front of `type:`) (#467)
