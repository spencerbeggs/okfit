---
"@okfit/mcp": minor
---

## Features

- `list_concepts` accepts `current` and the `unknown` status.
- `get_concept` returns `raw_status`, `staleness` and `replacement`.
- `stale_report` returns `malformed`, listing unreadable `stale_after` values.
- `validate_bundle` may return `okf_version: null` for a bundle that declares no version.
