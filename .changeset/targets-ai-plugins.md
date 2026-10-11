---
"@okfit/ai-plugins": patch
---

## Bug Fixes

### Hooks

* The post-tool-use validate hook passes the project root as `--root`, matching the CLI.
* The post-tool-use hook validates the edited file as a target, so it reports only that file's diagnostics without filtering a whole-bundle report.
