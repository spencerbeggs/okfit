---
"@okfit/core": minor
---

## Breaking Changes

`Derive.renderIndex` and `Derive.synthesizeIndex` now render `index.md` through `@effected/markdown`'s emitter instead of string templates. Titles and descriptions are escaped only where markdown would read them as syntax (`node_modules` stays as written, `<pkg>` becomes `\<pkg>`), a link target containing a space is written in angle brackets, and the root frontmatter is emitted as `okf_version: '0.2'`. The parsed entries are unchanged. Existing `index.md` files are rewritten to the new form the next time `okfit sync` runs.
