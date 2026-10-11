---
"@okfit/profiles": patch
---

## Features

* New `Trust.evaluate` and `Trust.needsDigest`, with the `EvaluateInput` type, so a caller can evaluate a concept's trust signal from inputs it has already gathered
* `Trust.lint` accepts precomputed signals, so a surface that already holds them does not recompute digests
* `Trust.lint` no longer emits `verified-drift` for draft or deprecated concepts, which `okfit verify` refuses to re-bind; their signal still reads drifted
