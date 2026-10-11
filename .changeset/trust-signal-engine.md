---
"@okfit/engine": minor
---

## Breaking Changes

### Concept summaries and filters

* `ConceptSummary` gains required `tier`, `integrity` and `stale` fields.
* `toConceptSummary(concept, signal)` now requires the concept's trust signal.
* `ConceptFilter.verified` changes from a boolean to `"current" | "unverified"`: `"current"` matches concepts whose verification still binds the content, `"unverified"` matches concepts never verified. `ConceptFilter` also gains `drifted` and `stale`.
* `ConceptQuery.list` takes a `signals` map.

### Verify picker

* `selectPickerCandidates` and `selectStaleCandidates` take a required `locate` argument that resolves a concept's path.
* `PickerCandidate` gains `path` and `boundAt`.

Migration: compute signals once per bundle (`RunResult.signals` or `BundleSessionShape.signals()`) and pass them to `toConceptSummary` and `ConceptQuery.list`. Replace `verified: true` with `verified: "current"` and `verified: false` with `verified: "unverified"`.

## Features

### Trust signal on every result

* `RunResult.signals` and `BundleSessionShape.signals()` expose the per-concept trust signals computed for a run
* New `TrustDrift` type with `toTrustDrift` and `signalFor` to turn a signal into a consumer-facing drift description
* `QueryGetEnvelope.concept.drift` reports why a verified concept drifted
* `ContextEnvelope.trust` carries a trust summary, built by the new `runContextTrust`
* New `loadPreviews` loads the diff previews the verify picker shows for drifted concepts
