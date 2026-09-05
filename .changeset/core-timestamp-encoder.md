---
"@okfit/core": patch
---

## Bug Fixes

- `Timestamp` now encodes a whole-second instant as `2026-03-01T08:00:00Z`, without the `.000` millisecond component, so written stamps read like git's dates and the OKF sample bundles; non-zero milliseconds are kept and decoding is unchanged.
