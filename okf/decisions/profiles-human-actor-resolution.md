---
type: Decision
title: Human actor ids resolve through a four-step fallback order
description: A human actor id resolves through a four-step, first-hit-wins fallback order that prefers a configured spelling over an auto-derived one.
tags:
  - architecture
generated:
  by: human:spencer
  at: 2026-09-07T20:50:38Z
status: stable
verified:
  - by: human:spencer
    at: 2026-09-07T20:49:08Z
---

# Human actor ids resolve through a four-step fallback order

## Context

`generated.by`/`verified[].by` for a human writer needs one canonical
`human:<id>` string, but plain git identity (`user.name`/`user.email`) does
not itself produce one, and a repo may want a spelling that differs from
whatever git derives.

## Decision

Resolution follows a four-step, first-hit-wins order: (1) a `human:<id>`
entry in `config.actors.humans` matching case-insensitively, config spelling
returned; (2) `human:<email local part>`; (3) `human:<slug of user.name>`;
(4) `HumanActorUnresolvedError`
(ruling P-13). The
result always satisfies core's `Actor` regex.

## Alternatives rejected

Deriving the id purely from `user.name` (ignoring email) would produce
noisier, less stable ids across machines with slightly different name
capitalization or punctuation; deriving it purely from config with no git
fallback would force every contributor to hand-configure `actors.humans`
before authoring a single concept.

## Consequences

This repo's config need not declare `actors.humans` at all for
`human:spencer` to resolve correctly, since the git email local part
(`spencer@beggs.codes` → `spencer`) already matches; every concept in this
plan still hardcodes `generated: { by: human:spencer }` by hand rather than
invoking derivation. The first command to wire
`Derivation.generatedBy` into a write path is `okfit verify` (phase 2),
which stamps the resolved human actor into `verified`.
