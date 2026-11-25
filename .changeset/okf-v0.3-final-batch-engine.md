---
"@okfit/engine": minor
---

## Breaking Changes

`VerifyNotCurrentError` no longer has the optional `batch` field. A batch, an id list and the pickers now skip a concept that cannot be verified, so no refusal stops a whole selection. The error gains an optional `kind` (`"future"` or `"near-future"`) and its message is reworded. Drop any read of `batch`; read `kind` to tell how far ahead the `generated.at` is.

## Features

- `okfit sync` re-stamps a `generated.at` more than 5 minutes later than now, and stamps a changed concept no later than now. It never lowers a stamp when that would make a verification count: the re-stamp is skipped with the reason `verified-after-now`. `SyncSkip` is exported.
- Verify skips a concept that cannot be verified at the verification time, with the skip reason `not-current`, in a batch or an id list. The picker loaders leave such rows out and return the ids as `leftOut`.
- `VerifyBatchSkipReason` gains `not-current`. `VerifyOptions`, `VerifyBatchOptions` and `VerifyIdsOptions` take an optional `now`.
- `RunOptions.configPath` and `RunResult.legacyKeys` are new. `RevalidateResult.current` and the type `DiagnosticsByFile` are exported.

## Bug Fixes

- The 0.3 migration no longer reports an empty Computation section, and its refusal names the hand edit.
- A malformed config reports every invalid key, not only the first.
- Sync keeps a byte-order mark on `index.md` and `log.md`.
