---
"@okfit/engine": patch
---

## Bug Fixes

- `okfit sync` now replaces a null-valued `generated` key (`generated:` alone or `generated: ~`) with the full block from `actors.agent`, instead of skipping the concept as `generated-unsupported` while `generated-missing` promised sync would create it.
