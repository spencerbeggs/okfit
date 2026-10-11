---
"@okfit/profiles": minor
---

## Breaking Changes

* `Derivation.generatedBy` reads `git config okfit.actor` first, so a Git test double that answers every key with one value must return none for `okfit.actor`
* `GeneratedByError` gains `ActorConfigInvalidError`

## Features

* `Trust.signal`, `Trust.signals` and `Trust.inputOf` take the config as a second argument, and `EvaluateInput` gains `humans`; pass the merged config the concept was loaded under
* `Derivation.generatedBy` reads `git config okfit.actor` first, so a person can choose their `human:<id>` explicitly; a value with `@`, a glob, or a non-`human:` prefix fails the new `ActorConfigInvalidError`, and a value equal to an exact `[actors].humans` entry takes that entry's spelling
* New `Derivation.verifier` resolves the human and enforces a non-empty `[actors].humans` allow-list, failing the new `HumanActorNotAllowedError`
* Glob entries in `[actors].humans` are matched by the allow-list but never returned as a resolved id
* New `actor-not-allowed` drift reason: a binding whose actor a non-empty `[actors].humans` does not list is drifted and reported by `verified-drift`
* `DriftReason` is exported as a schema as well as a type
