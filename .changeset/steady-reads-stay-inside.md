---
"@okfit/core": minor
---

## Features

### Confined reads

`Bundle.load` now reads every file confined at the moment of reading, so a symlink swapped in after the walk cannot pull outside content into a bundle (#458). The primitives are public:

* `readConfinedBytes` and `readConfinedString` read a file only if it still resolves inside the bundle root
* `ConfinementError` is the failure, with a reason of `outside`, `unresolvable` or `changed`

A file that changed while it was being read becomes a `read-changed` diagnostic instead of a load failure.

### New `read-changed` lint

The `read-changed` code (lint key `read_changed`, default `warn`) reports a file that changed while the bundle was read. The `[lint]` table now has 44 keys.

## Bug Fixes

* `symlink-escape` now also covers a directory symlink that resolves out of the bundle, and any link that cannot be resolved (dangling, a loop, or unreadable). Pruned directory names stay silent, and hidden names are reported only with `includeHidden`
* `missing-index` no longer fires for a directory whose `index.md` exists but failed to load; the load failure is reported once instead (#512)
* The bundle walk uses the links report from `@effected/walker` for directory and dangling links
