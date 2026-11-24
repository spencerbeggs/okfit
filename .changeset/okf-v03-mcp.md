---
"@okfit/mcp": minor
---

## Features

- `list_concepts` accepts `current` and the `unknown` status.
- `get_concept` returns `raw_status`, `staleness` and `replacement`.
- `stale_report` returns `malformed`, listing unreadable `stale_after` values.
- `validate_bundle` may return `okf_version: null` for a bundle that declares no version.

## Bug Fixes

- `okf://index` refuses a root `index.md` that is a symlink out of the bundle or dangling (`index.md links out of the bundle`) instead of serving the outside file.
