---
type: Decision
title: Bundle, Graph, Derive, and Validate are static facades, not services
description: Bundle, Graph, Derive, and Validate are static facades (private-constructor classes with static members) rather than Effect services, because their operations are pure or depend only on FileSystem and Path.
tags:
  - architecture
generated:
  by: human:spencer
status: stable
---

# Bundle, Graph, Derive, and Validate are static facades, not services

## Context

`@okfit/core` ships four operations over a `LoadedBundle` — loading, graph
traversal, pure derivation, and validation — and had to decide whether each
is an Effect service (a `Context.Tag` plus a `Layer`) or a plain static-method
class, consistent with core's own "no opinions beyond the spec" framing
(`packages/core/CLAUDE.md`) and with `Bundle.load`'s actual signature,
`Effect.fn("Bundle.load")` with `R = FileSystem.FileSystem | Path.Path`.

## Decision

`Bundle`, `Graph`, `Derive`, and `Validate` are static facades — private-
constructor classes with static members, not services
(ruling D-6). Exactly one
true service exists in core, `OkfitConfigFile`, and even its layer is built
by the CLI later, never by core itself
(ruling D-7).

## Alternatives rejected

A full `Context.Service` wrapping for `Bundle`/`Graph`/`Derive`/`Validate`
would force every caller — including pure derivation helpers with no I/O at
all — to thread a service dependency they do not need, purely for idiom
consistency, and would duplicate config/service identity concerns across the
CLI, MCP, and Action consumers for no behavioral benefit.

## Consequences

`Bundle.load` is directly callable with only `FileSystem | Path` in its `R`
channel; profiles' and the CLI's code call these facades as plain function
calls with no `Layer.provide` boilerplate; the one real service
(`OkfitConfigFile`) stays a single shared identity across every consumer
because the CLI, not core, builds its layer (D-7).
