---
"@okfit/engine": minor
---

## Breaking Changes

- `RunOptions.projectRoot` and `BundleSessionOptions.projectRoot` are now required.
- The JSON, graph and stale envelopes' `okf_version` is `string | null` and reports the bundle's own declaration.
- Verifying a concept whose status is outside the vocabulary fails with `VerifyStatusUnknownError` unless the same write sets the status. Batch verify skips such a concept with reason `unknown-status`. `VerifyResult.status.from` is the raw status text.
- The version-mismatch warning is removed.

## Features

- Repository resources are checked only inside the project root. A value outside it is reported as `resource-outside-project` and is never read, stat'ed or passed to git.
- `ConceptSummary` gains `raw_status` and `staleness`; `ConceptFilter` gains `current` and accepts the `unknown` status; `ConceptQuery.get` gains `replacement`; `rawStatusOf` is exported.
- The stale envelope gains `malformed` and `summary.malformed`, listing unreadable `stale_after` values.
- `mv` rewrites `computation`, `executor.resource`, `attester.resource`, `superseded_by` and a single-mapping `sources`. It now runs on a bundle that holds non-concept `.md` files and rewrites their links (`ReferenceSource` is exported).
- `init` writes `title` and `description` into a new root index.

## Bug Fixes

- `sync` skips an `index.md` or `log.md` that is a symlink out of the bundle (skip reason `symlink-escape`).
- `sync` never stamps a version into a root index that declares none, unless the config names one.
