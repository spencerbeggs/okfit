---
"@okfit/engine": minor
---

## Features

### `sync` creates a missing `generated:` block

When `actors.agent` is configured, `runSync` now creates a `generated:` block for a concept that has none, attributed to that agent, instead of only reporting it skipped (issue #73). Digest drift is still decided first, before any provenance lookup, so an already-stamped, unchanged concept costs no git call.

### `sync` walks git only for concepts that need it

`runSync` no longer derives `Derivation.generatedAt` for every concept up front. It now walks history only for a concept whose recorded digest doesn't match its current body, or that log mode still needs (issue #21). On this repo's own bundle, `okfit sync --dry-run` drops from roughly 1.68s to 0.27s.

One user-visible reclassification falls out of the digest-first reorder: a dirty (uncommitted) concept whose body digest still matches its recorded `generated.body_sha256` is now reported `unchanged` rather than `skipped: dirty`, since drift is decided before provenance is even looked at.

### `sync --since` and `sync --staged`

`SyncOptions` gains two new options:

- `logSince`: an inclusive `YYYY-MM-DD` floor for log mode; concepts committed on or after it are considered (default: the newest date already logged).
- `staged`: stamps only the concepts currently in the git index with a caller-given instant, instead of walking history, and re-adds what was written. Log mode cannot be combined with `staged` — attempting it fails with the new `SyncStagedLogError`.

Log mode's window is now inclusive of the newest logged day (issue #18): a concept committed on a day that already has a `## YYYY-MM-DD` group is appended into that group instead of being dropped, deduped against the `Added`/`Updated` lines sync itself wrote so re-running over the same window never duplicates. Hand-written prose is never compared.

### Batch verification: `runVerifyBatch`

A new `runVerifyBatch` function attests every unverified concept whose type declares `require_verified`, optionally narrowed to specific types, in one pass — pairing with the CLI's new `verify --all`/`--type`. It returns a `VerifyBatchResult` (via the new `VerifyBatchOptions`/`VerifyBatchSkipReason` types) with per-concept written fragments and skip reasons (`"draft"` or `"already-verified"`). `VerifyBatchEnvelope`/`verifyBatchEnvelope` render it for `--format json`.

The new `VerifySelectionError` is raised for a contradictory or empty verify selection (missing id/`--all`/`--type`, both given, or an unknown `--type`); like other usage errors it exits `64`.

`SyncStagedLogError` and `VerifySelectionError` both carry `[Runtime.errorExitCode] = 64`, so `render/json.ts`'s `jsonError`/`JsonErrorEnvelope` now surface `exit_code: 64` for them under `--format json` — `JsonErrorEnvelope.exit_code` is `3 | 64`, no longer the literal `3`.
