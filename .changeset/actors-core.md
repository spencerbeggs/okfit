---
"@okfit/core": minor
---

## Breaking Changes

`[actors].humans` entries decode as the new `ActorPattern` type instead of `Actor`, so they may be id globs such as `human:spencer*`. Code that read `config.actors.humans` as `ReadonlyArray<Actor>` now receives `ReadonlyArray<ActorPattern>`.

## Features

* New `ActorPattern` schema and the `Actor.matches`, `Actor.allowed` and `Actor.isPattern` helpers for `[actors].humans` allow-lists
* New `actor-email` lint (default `warn`) for an actor carrying an email address in a concept or in `[actors].humans`
* New `verified-actor-unknown` lint (default `warn`) for a human verifier that a non-empty `[actors].humans` does not list
