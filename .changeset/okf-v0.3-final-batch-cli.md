---
"@okfit/cli": minor
---

## Features

- `okfit validate --target` counts refused fixes apart in its summary.
- `okfit validate` points at `okfit sync` when a bundle uses old key names.
- `okfit verify` prints a `skipped` line for each concept a batch or id list skips because its `generated.at` is later than the verification time.
- The `okfit verify` and `okfit stale --verify` pickers print one `left out` line naming the concepts they leave out, and "nothing to verify now" when that leaves nothing.
- `okfit sync` prints the re-stamp it skipped, and why.

## Bug Fixes

- A malformed config error lists every bad key, not only the first.
- The stale-version warning names the config file.
