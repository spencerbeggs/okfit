---
"@okfit/profiles": minor
---

## Breaking Changes

* `RendersEntry.body_sha256` is now `RendersEntry.body`
* `bodyDigest` returns a 16-hex truncated SHA-256 instead of the full digest
* Generated and Publication digests are read from `integrity.generated.body` and `renders[].body`

## Features

* The `verified-drift` lint fires when a verified concept's body or authored frontmatter no longer matches `integrity.verified.content`. It is a signal, not a gate
* New canonical content digest over body plus authored frontmatter, used to bind verification

## Documentation

* The software-project Decision guidance now allows editing stable Decisions, with drift prompting re-verification

## Bug Fixes

* The `stale` lint description is corrected
