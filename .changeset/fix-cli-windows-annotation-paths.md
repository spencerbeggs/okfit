---
"@okfit/cli": patch
---

## Bug Fixes

- Fix GitHub annotation file paths on Windows runners: a bundle outside the workspace no longer yields a `..\` path, and workspace-relative paths always use forward slashes.
