---
"@okfit/engine": minor
---

## Features

- Adds `selectStaleCandidates` and `loadStaleCandidates` for finding the concepts whose `stale_after` has passed, and a `VerifyIdsOptions.refreshStaleAfter` option that rolls `stale_after` forward and overwrites the actor's own `verified[].at` entry when re-attesting.
- Adds `planSync` and `applySyncPlan`, which split sync into a reviewable plan and its application. `runSync` behaves the same from the outside.
- `VerifySelectionError` gains a `dry-run-needs-verify` reason.
