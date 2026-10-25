---
"@okfit/cli": minor
---

## Features

* `okfit sync --staged` runs all three modes by default, so a pre-commit hook commits each concept's `log.md` entry alongside it instead of leaving it for a follow-up commit
* `okfit sync --staged --only log` is now a valid narrowing rather than a usage error (exit 64)

## Bug Fixes

* `okfit sync --staged` in a linked git worktree stages regenerated sub-directory indexes at their real paths instead of a phantom repo-root `decisions/index.md`
