---
"@okfit/profiles": minor
---

## Breaking Changes

* `RendersEntry.body_sha256` is now `RendersEntry.body`
* `Derivation.bodyDigest` returns a 16-hex truncated SHA-256 instead of the full digest
* Generated and Publication digests are read from `integrity.generated.body` and `renders[].body`

## Features

### Trust

New `Trust` facade with `signal`, `signals` and `lint`, plus the `ConceptSignal`, `IntegrityState` and `DriftReason` types. The `verified-drift` lint fires when a verified concept's body or authored frontmatter no longer matches `integrity.verified.content`, when a human entry carries no binding, or when a later human entry is not the bound one. It is a signal, not a gate.

### Canonical

New `Canonical` facade with `json`, `contentInput` and `EXCLUDED_KEYS`: the exact string a content digest hashes, insensitive to quoting, flow or block style, key order and CRLF. Integers beyond 2^53 are encoded as their decimal literal.

### Derivation

* `Derivation.digest` and `Derivation.digestFull` hash a string to a 16-hex or full SHA-256
* `Derivation.contentDigest` hashes the canonical content input of a concept
* `Derivation.recordedBody` reads a concept's recorded body digest from `integrity.generated.body`, else a legacy `generated.body_sha256`

## Documentation

* The software-project Decision guidance now allows editing stable Decisions, with drift prompting re-verification

## Bug Fixes

* The `stale` lint description is corrected
* The `generated-at-drift` message names `generated.body_sha256` when the recorded digest came from that legacy field
