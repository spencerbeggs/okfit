---
"@okfit/engine": minor
---

## Breaking Changes

* Removed `SyncStagedLogError`: `runSync` with `staged` now runs log mode instead of refusing it. Drop any `catchTag("SyncStagedLogError")` branch; there is nothing left to catch.

## Features

### Staged log entries

`runSync({ staged })` with log mode selected writes the commit's own `log.md` entry for each staged concept and re-adds `log.md` to the index, so a pre-commit hook no longer leaves the log one commit behind.

* The group date is the `staged.at` instant; the verb is `Added` for a path `HEAD` lacks and `Updated` otherwise
* Re-running for an amend, or a later ordinary sync, leaves the log `unchanged`
* A `log.md` with unstaged edits is skipped with reason `dirty` instead of being staged

## Bug Fixes

* `runSync({ staged })` from a linked worktree's pre-commit hook no longer stages a sub-directory index at a repo-root path (`decisions/index.md`) or misses the staged concepts; the repository root no longer comes from `git rev-parse --show-toplevel`, which names the bundle root when `GIT_DIR` is exported
* `runSync({ staged })` re-adds `index.md` and `log.md` at their real paths, like the concepts it re-adds, when the bundle root is reached through a symlink or the file is itself one
