---
"@okfit/profiles": patch
---

## Refactoring

* Hash persisted `integrity.*` digests directly through core's `Digest` service instead of `JsoncFingerprint.hashText`; digest output is byte-identical
