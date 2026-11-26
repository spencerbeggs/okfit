---
"@okfit/mcp": patch
---

## Bug Fixes

* Concept resources re-check containment on every read and read the file confined, so a link swapped in after the bundle loaded cannot serve outside content (#460)
* Resource errors name the bundle-relative path instead of the absolute path
* A file that changed during a read is reported as transient: "changed while it was read; try again"
