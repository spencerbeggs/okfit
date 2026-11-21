---
"@okfit/cli": minor
---

## Features

* `okfit validate` and `okfit lint` now report references to gitignored or untracked files as `resource-ignored` and `resource-untracked`. `--skip-provenance` also skips these git-backed lints, so the PostToolUse hook stays git-free.
