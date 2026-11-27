---
"@okfit/core": minor
---

## Features

### Confined reads

`Bundle.load` now reads every file confined at the moment of reading, so a symlink swapped in after the walk cannot pull outside content into a bundle (#460). The primitives are public:

* `readConfinedBytes` and `readConfinedString` read a file only if it still resolves inside the bundle root
* `ConfinementError` is the failure, with a reason of `outside`, `unresolvable` or `changed`

`IndexDocument` and `LogDocument` carry an optional `source`: the text the load read, without a leading BOM.

`changedWhileRead(subject)` is the one spelling of the transient wording, `"<subject>" changed while it was read; try again`, which `ConfinementError` and the CLI, engine and MCP messages share.

A file that changed while it was being read becomes a `read-changed` diagnostic instead of a load failure.

### New `read-changed` lint

The `read-changed` code (lint key `read_changed`, default `warn`) reports a file that changed while the bundle was read. The `[lint]` table now has 44 keys.

## Bug Fixes

* `symlink-escape` now also covers a directory symlink that resolves out of the bundle, and any link that cannot be resolved (dangling, a loop, or unreadable). A pruned name (`node_modules` by default) is silent for a file link too: the link is never read or reported. Hidden names are reported only with `includeHidden`
* `missing-index` no longer fires for a directory whose `index.md` exists but failed to load; the load failure is reported once instead (#512)
* `missing-index` is not reported for a directory whose `index.md` was refused as `read-changed`; only `read-changed` reports it
