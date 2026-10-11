---
"@okfit/profiles": minor
---

## Breaking Changes

`Trust.signal`, `Trust.signals` and `Trust.inputOf` take the config as a new second argument, and `EvaluateInput` gains `humans`. Pass the merged config the concept was loaded under.

## Features

* `Derivation.generatedBy` reads `git config okfit.actor` first, so a person can choose their `human:<id>` explicitly; a value with `@`, a glob, or a non-`human:` prefix fails the new `ActorConfigInvalidError`
* New `Derivation.verifier` resolves the human and enforces a non-empty `[actors].humans` allow-list, failing the new `HumanActorNotAllowedError`
* Glob entries in `[actors].humans` are matched by the allow-list but never returned as a resolved id
* New `actor-not-allowed` drift reason: a binding whose actor a non-empty `[actors].humans` does not list is drifted and reported by `verified-drift`
* `DriftReason` is exported as a schema as well as a type
