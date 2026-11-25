---
"@okfit/engine": minor
---

## Breaking Changes

`loadPickerCandidates` and `loadStaleCandidates` now return `leftOut` as `ReadonlyArray<VerifySkip>`, sorted by id, instead of a sorted `ReadonlyArray<string>` of ids. Read `leftOut.map((entry) => entry.id)` to get the ids.

## Features

- New exports `futureAtRefusal`, `notCurrentDetail`, `NotCurrentDetail` and `VerifySkip`.
- The `skipped` entries of a batch, an id list and `selectAttestable` are `VerifySkip`. A `not-current` skip carries `notCurrent`, and an `unknown-status` skip carries the raw `status`.
- `VerifySelectionError` gains the reason `at-future`. `runVerify`, `runVerifyBatch` and `runVerifyIds` refuse with it when given `now` and an `at` more than 5 minutes later than it.
- `runVerifyIds` skips a concept with an unknown status, with the reason `unknown-status`, and verifies the rest. It used to fail the whole call.

## Bug Fixes

- The move planner keeps a UTF-8 byte-order mark on the files it rewrites.
- When a move repairs links in a concept whose recorded body digest matched before, the digest is re-recorded, so the next sync keeps `generated.at`. A stale or missing digest, and a concept still on old key names, are not re-recorded.
- If a matching digest cannot be re-recorded because of the integrity block's layout, the concept is listed in `drifts`, even if no human verified it.
- For a root `index.md` whose frontmatter is never closed, `okf-version-undeclared` now carries a `fix`, and the migration refuses that fix with the reason.
