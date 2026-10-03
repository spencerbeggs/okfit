---
"@okfit/profiles": patch
---

## Bug Fixes

- `publication-orphan` now also fires for an empty `renders` list and for a `surface` that resolves to a concept that is not a `Surface`; the message names the actual type. An absent `surface` is left to `required-key-missing` instead of producing a second, unclear message.
