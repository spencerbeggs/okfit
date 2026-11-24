---
"@okfit/cli": minor
---

## Features

- `okfit validate` and `okfit lint` report `resource-outside-project`; JSON envelopes may carry `okf_version: null`.
- `okfit query list` accepts `--status unknown` and `--current`; `okfit query get` shows the replacement of a deprecated concept and its `raw_status`.
- `okfit stale` lists unreadable `stale_after` values, and `--verify` never offers one.
- `okfit init` writes the bundle `title` and `description`, and `--version` reports `okf 0.3`.

## Bug Fixes

- `okfit verify` refuses a concept with an out-of-vocabulary status (exit 3) unless `--stable` or `--draft` is passed, and refuses before the re-verify prompt.
- `okfit mv` works on a bundle that has non-concept markdown such as a `README.md`.
- The `okfit stale` stderr summary appends `, K malformed` when any `stale_after` value is unreadable; `staleSummary` takes an optional fourth argument for it.
