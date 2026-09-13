---
"@okfit/core": minor
---

## Features

* New lint code `footnote-undefined` (default `warn`, configurable via `[lint].footnote_undefined`): flags a `[^label]` footnote reference in a concept's body that has no matching `[^label]: ...` definition line. Complements `footnote-source-unknown`, which only checks a label against `sources[].id`.

## Bug Fixes

* `require-verified-unmet` no longer fires on a concept with `status: draft` — a draft is unsettled by definition, so it is exempt from the type's `require_verified` requirement.
* Adapted to `@effected/walker` 0.9.0: an unreadable directory entry now carries the underlying `PlatformError` reason, and the `walk-unreadable` diagnostic names it instead of reporting the directory alone.
* The published config JSON Schema (`schemas/config/okfit-1.0.0.json`) closes every declared table again; since `effect@4.0.0-rc.113` left structs open by default it had temporarily accepted unknown keys inside declared tables. Unknown *top-level* keys remain permitted, unchanged.
