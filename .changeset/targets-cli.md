---
"@okfit/cli": minor
---

## Breaking Changes

### The project root is a flag

* Every command takes the project root as `--root <dir>` instead of a trailing `[path]` positional, so positionals name concept targets everywhere. Replace `okfit validate ./project` with `okfit validate --root ./project`.
