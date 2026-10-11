---
"@okfit/cli": minor
---

## Breaking Changes

`okfit query --verified` now means verified and still current: concepts whose content drifted since verification no longer match. Use the new `--unverified` for concepts never verified.

Migration: scripts that relied on `--verified` matching every concept ever verified should also run `okfit query --drifted` to include drifted ones.

## Features

### Trust signal in query

* `okfit query --drifted` lists concepts edited after they were verified, and `--stale` lists concepts past their `stale_after`
* `okfit query list` shows a trust column
* `okfit query get` prints tier, integrity and stale lines
* `okfit query get --format json` includes a `drift` object for drifted concepts

### Trust summary in context

`okfit context --trust` appends a trust summary of the bundle.

### Drift preview in the verify picker

The interactive `okfit verify` picker previews the diff of a drifted concept before you confirm re-verification.
