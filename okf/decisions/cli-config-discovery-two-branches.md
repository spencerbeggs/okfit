---
type: Decision
title: Config discovery is two branches, never one chain
description: The CLI resolves config through exactly one of two branches, either an explicit --config path or an upward-walk-plus-XDG discovery chain, never a single merged chain.
tags:
  - architecture
generated:
  by: human:spencer
  at: 2026-09-06T11:25:53Z
  body_sha256: c6b361b69e4341d63c4743f2bf4b67016c08d3e0cc2e67bbd35d701171bf1ef0
status: deprecated
verified:
  - by: human:spencer
    at: 2026-09-07T20:49:06Z
---

# Config discovery is two branches, never one chain

## Context

`okfit` needs to find `.config/okfit/config.toml` (or `okfit.config.toml`)
with no flag at all in the common case, but `--config <file>` also needs to
mean exactly that file and nothing merged in around it.

## Decision

An explicit `--config` short-circuits to a `ConfigFile.layer` built directly
with only `ConfigResolver.explicitPath(p)` — no upward walk, no XDG probe
(ruling K-10). Otherwise
the discovery chain is `upwardWalk("config.toml", {
subpaths: [".config/okfit"] })`, then `upwardWalk("okfit.config.toml")`, then
the app's XDG entries, with `MergeStrategy.firstMatch`, built through
`AppConfig.layer`; one `provideConfig` function in `config/layer.ts` produces
whichever branch applies (ruling K-57, reconciling K-9/K-10).

## Alternatives rejected

A single resolver chain that always includes upward-walk and XDG even when
`--config` is supplied would let an unrelated ambient config file silently
merge into the one the caller explicitly named, contradicting what
"explicit" is supposed to mean; never supporting upward-walk/XDG discovery
at all would force every invocation in this repo — and every CI step — to
pass `--config` by hand.

## Consequences

This repo's `.config/okfit/config.toml` (written in Task S1) is found
automatically from any subdirectory with no flag needed; Task V1's
`dogfood.e2e.test.ts` and Task V2's CI step both rely on exactly this —
neither passes `--config` explicitly.
