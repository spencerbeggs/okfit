---
"@okfit/ai-plugins": patch
---

## Bug Fixes

Fix the `okf-config` skill's markdownlint advice to point at the config markdownlint actually loads (the file a `lint:md`-style script names with `--config`, otherwise the root `.markdownlint-cli2.jsonc`) instead of always a new root file, which has no effect next to a `--config`-loaded one.
