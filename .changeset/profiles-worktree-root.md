---
"@okfit/profiles": minor
---

## Features

* `Derivation.worktreeRoot(start)` resolves the repository root by walking up to the nearest `.git` entry, which stays correct inside a linked worktree's git hook where `git rev-parse --show-toplevel` does not

## Bug Fixes

* `Derivation.generatedAt` derives the right commit for a concept in a linked worktree when `GIT_DIR` is exported (as in a pre-commit hook), instead of reporting it `untracked`
