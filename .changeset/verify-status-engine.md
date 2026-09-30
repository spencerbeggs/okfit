---
"@okfit/engine": minor
---

## Features

### Verify sets status with the attestation

* `runVerify` takes an optional target status and splices it in the same write as the attestation; `VerifyEnvelope` gains `status: { from, to } | null`
* `selectAttestable` holds the batch selection rules once and now skips `deprecated` concepts, reporting the reason `deprecated` beside `draft` and `already-verified`

### Concept queries

* `ConceptQuery` (`list`, `get`, `neighbors`) is the shared read-only query layer, with `QueryListEnvelope`, `QueryGetEnvelope` and `QueryNeighborsEnvelope` for front ends to render

## Bug Fixes

* `okfit verify` no longer drops a leading UTF-8 byte-order mark when it writes a concept back
