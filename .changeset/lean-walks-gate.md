---
"@okfit/engine": patch
---

## Bug Fixes

- `validate` now runs the publication lints only under the `software-project` profile, so a repository using `profile = "none"` that declares its own `Publication` type no longer gets them.

## Performance

- The `surface-unmatched` check walks only as deep as the resource glob can match, skips `node_modules` and dot-directories the pattern does not name (including through braces, classes and extglobs), never follows symlinked directories, and splits the glob on the path as written rather than the resolved absolute path.
