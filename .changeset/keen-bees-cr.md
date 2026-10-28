---
"@okfit/core": patch
---

## Bug Fixes

* Diagnostic positions that land on the `\n` of a `\r\n` line ending no longer report character `-1`.
* `DiagnosticRange.fromOffset` clamps an offset past the end of the text to the end, and throws a `RangeError` for a non-integer offset.
