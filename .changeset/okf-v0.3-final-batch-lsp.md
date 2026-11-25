---
"@okfit/lsp": patch
---

## Bug Fixes

- A bundle-level diagnostic and the root `index.md`'s own are published together, so one no longer replaces the other.
- The stale-version warning names the config file.
- The "not current" message for Mark verified says how far ahead the `generated.at` is, and what to do about it.
