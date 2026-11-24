---
"@okfit/engine": minor
---

## Breaking Changes

- `RunOptions.projectRoot` and `BundleSessionOptions.projectRoot` are now required.
- The JSON, graph and stale envelopes' `okf_version` is `string | null` and reports the bundle's own declaration.
- Verifying a concept whose status is outside the vocabulary fails with `VerifyStatusUnknownError` unless the same write sets the status. Batch verify skips such a concept with reason `unknown-status`. `VerifyResult.status.from` is the raw status text.
- The version-mismatch warning is removed.
- `ScaffoldOptions.okfVersion` is now required: `init`'s scaffold writes that version into the root index instead of the spec constant, so a caller building `ScaffoldOptions` must pass it.
- `StaleEnvelope` gains a required `malformed` array and `summary.malformed`, and the input of `staleEnvelope` requires `malformed`. `ConceptSummary` gains required `raw_status` and `staleness`, and `QueryGetEnvelope`'s concept gains a required `replacement` (`string | null`). Decoding an envelope written by an older engine with these schemas now fails.
- The output unions widened: `SkipReason` gains `symlink-escape`; `VerifyBatchSkipReason` and `VerifyBatchEnvelope.skipped[].reason` gain `unknown-status`. An exhaustive `switch` over either must handle the new literal.
- `VerifyEnvelope.status.from` is widened from `Status | null` to `string | null`, because the status being replaced may be outside the vocabulary.

## Features

- Repository resources are checked only inside the project root. A value outside it is reported as `resource-outside-project` and is never read, stat'ed or passed to git.
- `ConceptSummary` gains `raw_status` and `staleness`; `ConceptFilter` gains `current` and accepts the `unknown` status; `ConceptQuery.get` gains `replacement`; `rawStatusOf` is exported.
- The stale envelope gains `malformed` and `summary.malformed`, listing unreadable `stale_after` values.
- `mv` rewrites `computation`, `executor.resource`, `attester.resource`, `superseded_by` and a single-mapping `sources`. It now runs on a bundle that holds non-concept `.md` files and rewrites their links (`ReferenceSource` is exported).
- `init` writes `title` and `description` into a new root index.
- `escapesBundle` and `escapesRoot` are exported: whether a reserved `index.md` or `log.md` is a symlink out of the bundle (a dangling link counts), the one check `sync`, `context` and the MCP server share.

## Bug Fixes

- `sync` skips an `index.md` or `log.md` that is a symlink out of the bundle (skip reason `symlink-escape`).
- `sync` never stamps a version into a root index that declares none, unless the config names one.
- `context` reports `index_exists: false` for a root `index.md` that is a symlink out of the bundle or dangling, and never stats its target. The session-start hook therefore no longer prints such a file.
- A Surface `resource` glob with a leading `/` resolves from the bundle root, not from the Surface's directory.
