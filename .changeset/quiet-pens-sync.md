---
"@okfit/engine": patch
---

## Bug Fixes

* `okfit sync --staged` finds the repository root with the hook-safe `repoRoot`, which stays correct inside a linked worktree's git hook.
* Error text renders through `ErrorText.describe`: a non-`Error` value without a `message` now appears as JSON rather than `[object Object]`.
