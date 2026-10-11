---
"@okfit/engine": minor
---

## Features

### Concept targets

- `Targets.resolve(args, bundle, cwd)` resolves any mix of absolute paths, cwd-relative paths and concept ids to concepts, all or nothing. A failure lists every bad argument, with a nearest-id suggestion where one exists, as one `TargetResolutionError` (exit 64). Pass `{ files: true }` to accept any bundle file, such as `index.md`.
- `runRevokeIds` revokes several concepts all or nothing.
