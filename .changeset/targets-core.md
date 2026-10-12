---
"@okfit/core": minor
---

## Features

### Link resolution

- `Graph.resolve(bundle, from, raw)` resolves one reference the way the link graph does and reports which rule matched (`via`: rooted, file-relative or bundle-root-relative).

## Bug Fixes

### Missing directory indexes

- `missing-index` now also flags a directory that holds no concept itself but is the ancestor of one, which its parent index links to. `Derive.indexDirectories(bundle)` lists every directory that owes an `index.md`.
