---
"@okfit/lsp": patch
---

## Bug Fixes

- `okfit-lsp` no longer crashes with `process.stdin.unref is not a function` when started with stdin from a file or `/dev/null` instead of a pipe.
