---
"@okfit/engine": minor
---

## Features

### Concept targets

- `Targets.resolve(args, bundle, cwd)` resolves any mix of absolute paths, cwd-relative paths and concept ids to concepts, all or nothing. A failure lists every bad argument, with a nearest-id suggestion where one exists, as one `TargetResolutionError` (exit 64). Pass `{ files: true }` to accept any bundle file, such as `index.md`.
- `runRevokeIds` revokes several concepts all or nothing.

### Moving a concept

- `planMove`/`runMove` move a concept and rewrite every reference to it across the bundle, keeping each reference's spelling. Nothing is written unless every reference can be rewritten.
- `okfit mv` refuses to move the bundle's root project file (`MoveError` reason `project-file`) and refuses a destination that reaches outside the bundle through a symlinked directory.

## Bug Fixes

### Sync and nested directories

- `okfit sync` now writes the missing `index.md` of a directory that holds only a nested directory, such as `topics/` after a concept moves to `topics/deep/`, so the link its parent index already carries no longer dangles.
