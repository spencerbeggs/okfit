---
"@okfit/cli": patch
---

## Bug Fixes

* `okfit sync` explains a skipped `index.md` that cannot be parsed (`index-unparseable`) and one that changed while it was read (`changed-during-read`), each with the next step
* `okfit verify` batch output explains a file skipped because it changed while the bundle was read
* `okfit mv` explains that it refused because files changed during the load, and that nothing was moved
* `okfit query get`, `query neighbors` and `okfit verify <id>` say a concept "changed while it was read; try again" instead of reporting it missing
