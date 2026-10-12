---
"@okfit/ai-plugins": patch
---

## Bug Fixes

### Hooks

* The post-tool-use validate hook passes the project root as `--root`, matching the CLI. `--root` and file targets arrived in `@okfit/cli` 0.13.0, so install that version or later alongside this plugin.
* The post-tool-use hook validates the edited file as a target, so it reports only that file's diagnostics without filtering a whole-bundle report.
* When the scoped `validate --root` call exits 64, which is what a CLI older than 0.13.0 does, the hook retries once with the earlier form (`validate <project root>`, whole bundle) and keeps its per-file filter, so conformance blocking survives a plugin newer than the project's pinned CLI.

## Features

* The `okf-authoring` skill and the `okf-docs` agent name concept files for their topic and rename them with `okfit mv`.
