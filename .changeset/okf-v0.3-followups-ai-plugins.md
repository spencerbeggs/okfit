---
"@okfit/ai-plugins": patch
---

## Bug Fixes

- The PostToolUse hook reads CRLF and BOM frontmatter.
- The PostToolUse hook compares physical paths, so a symlinked path form no longer skips its checks.
- The `okf-upgrade`, `okf-config` and `okf-authoring` skills cover the new `computation-missing` and `config-okf-version-stale` lints and the `--fix` refusals.
