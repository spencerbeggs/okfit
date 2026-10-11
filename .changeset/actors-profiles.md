---
"@okfit/profiles": minor
---

## Features

* `Derivation.generatedBy` reads `git config okfit.actor` first, so a person can choose their `human:<id>` explicitly; a value with `@`, a glob, or a non-`human:` prefix fails the new `ActorConfigInvalidError`
* New `Derivation.verifier` resolves the human and enforces a non-empty `[actors].humans` allow-list, failing the new `HumanActorNotAllowedError`
* Glob entries in `[actors].humans` are matched by the allow-list but never returned as a resolved id
