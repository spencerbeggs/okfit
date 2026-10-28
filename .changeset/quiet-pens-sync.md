---
"@okfit/engine": patch
---

## Bug Fixes

* `okfit sync --staged` finds a repository defined only by `GIT_DIR` and `GIT_WORK_TREE`, with no `.git` on disk, by retrying with that environment honoured when the hook-safe lookup finds none.
* Error text renders through `ErrorText.describe`: a non-`Error` value without a `message` now appears as JSON rather than `[object Object]`.

## Maintenance

* `okfit sync --staged` resolves the repository root with `@effected/git`'s hook-safe `repoRoot` in place of its own worktree walk.
