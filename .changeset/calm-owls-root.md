---
"@okfit/profiles": minor
---

## Breaking Changes

`Derivation.worktreeRoot` has been removed. Resolve the repository root with `Git.repoRoot(dir, { ignoreRepositoryEnv: true })` from `@effected/git`, which is also what `Derivation.generatedAt` now uses.

## Bug Fixes

* `generatedAt` derivation resolves the repository root with the hook-safe `repoRoot`, so it stays correct inside a linked worktree's git hook.
