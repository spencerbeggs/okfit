---
"@okfit/profiles": minor
---

## Breaking Changes

`Derivation.worktreeRoot` has been removed. Resolve the repository root with `Git.repoRoot(dir, { ignoreRepositoryEnv: true })` from `@effected/git`, which is also what `Derivation.generatedAt` now uses.

## Bug Fixes

* `generatedAt` derivation again finds a repository defined only by `GIT_DIR` and `GIT_WORK_TREE` (a bare-dotfiles setup with no `.git` on disk), by retrying with that environment honoured when the hook-safe lookup finds none.
