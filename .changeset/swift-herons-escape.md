---
"@okfit/cli": patch
---

## Bug Fixes

* `validate` now surfaces two additional lint diagnostics from `@okfit/core`/`@okfit/engine`: `status-missing` (off by default) and `source-resource-missing` (warn by default), plus more accurate `broken-links` reporting for links whose target file exists but is missing the linked heading.
* `sync`'s generated `index.md` entries now escape markdown-active characters in concept titles and descriptions, so text containing them (`` \ < > * _ ` [ ] ``) renders as literal characters instead of broken formatting.
