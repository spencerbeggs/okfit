---
"@okfit/profiles": patch
---

## Bug Fixes

* `Derivation.humanActorId` trims the leading and trailing dashes of a name slug with an index walk instead of `/^-+|-+$/`, whose `-+$` alternative backtracked quadratically over a long dash run (CodeQL `js/polynomial-redos`).
