---
"@okfit/core": minor
---

## Breaking Changes

`Derive.trustTier` now follows OKF 0.3 §5.3: it counts only current verification events, for every bundle whatever `okf_version` it declares. An event is current when it is dated at or after the concept's `generated.at`, or when `generated` or `generated.at` is absent. Earlier events stay in the file as history and count for nothing, so a concept's tier can drop after its content changes. Re-run `okfit verify` on concepts that now report a lower tier or the new `verified-before-change` warning.

## Features

- New `Derive.isCurrent(concept, at)`, which answers whether a verification event at `at` is current. It reads only `generated`, so a caller without a whole concept can pass `{ generated }`.
- New `Derive.currentVerifications(concept)`, which returns the current `verified` entries in list order.
- New lint `verified-before-change` (default `warn`, config key `verified_before_change`; the config schema document now has thirty-nine keys, and the schema version stays `1.0`). It fires when events dated before the last change would have given a higher tier than the current ones, and names the newest event that lost its weight. Draft, deprecated and unknown-status concepts are exempt.

## Bug Fixes

`require-verified-unmet` on a concept with an unknown status now names a way out (set the status first, or verify with `okfit verify --stable` or `--draft`) instead of the bare "requires a verified entry" message.
