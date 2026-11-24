---
"@okfit/engine": minor
---

## Breaking Changes

- New `VerifyNotCurrentError` (exit code 3). `verify` now refuses to write a verification dated before the concept's `generated.at`, since OKF 0.3 §5.3 would not count it. This applies on every write path, including `stale --verify`, whether the early time came from `--at` or from a clock behind a future `generated.at`. A batch fails whole. Callers that handle verify failures exhaustively must handle the new error; the fix is to verify at or after `generated.at`.
- "Already verified" now requires a current binding, so batch verify and the interactive picker no longer skip a concept that was verified before its last change; it is selected again.
- The drift reason in verify, query and stale envelopes may now be `verified-before-change`. An exhaustive `switch` over drift reasons must handle it.

## Features

`sync` now stamps `generated.at` as the earlier of the derived instant and a human verification binding that covers exactly the current content. Content that was verified and then committed keeps its verification current instead of being outdated by the commit time.
