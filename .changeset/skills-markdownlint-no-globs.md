---
"@okfit/ai-plugins": patch
---

## Bug Fixes

Fix the markdownlint scoping advice in the `okf-authoring` and `okf-config` skills so a per-file lint run passes `--no-globs`. markdownlint-cli2 unions a config's `globs` with the file arguments, so a "scoped" run on a config with `globs` and `fix: true` otherwise autofixed the whole tree.
