---
"@okfit/cli": patch
---

## Bug Fixes

* `NO_COLOR` now disables colour for any non-empty value, matching the [no-color.org](https://no-color.org) rule. Previously only `NO_COLOR=1` had an effect; `NO_COLOR=true`, `NO_COLOR=yes`, or any other non-empty value was ignored.
