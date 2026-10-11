---
type: Decision
title: Human actor ids resolve through a five-step fallback order
description: A human actor id resolves through a five-step, first-hit-wins fallback order that prefers an explicit git config id, then a configured spelling, over an auto-derived one.
tags:
  - architecture
generated:
  by: human:spencer
  at: 2026-10-11T20:51:30Z
status: stable
verified:
  - by: human:spencer
    at: 2026-09-07T20:49:08Z
  - by: human:spencer
    at: 2026-10-11T14:21:44Z
  - by: human:spencer
    at: 2026-10-11T17:15:25Z
integrity:
  generated:
    body: 2a1a3f6fd97b7a8a
  verified:
    by: human:spencer
    at: 2026-10-11T17:15:25Z
    content: e7a9cc59b94b7eac
---

# Human actor ids resolve through a five-step fallback order

## Context

`generated.by`/`verified[].by` for a human writer needs one canonical
`human:<id>` string, but plain git identity (`user.name`/`user.email`) does
not itself produce one, and a repo may want a spelling that differs from
whatever git derives.

## Decision

Resolution follows a five-step, first-hit-wins order: (1) `git config
okfit.actor`, which must be a `human:<id>` with no `@` and no glob
(`ActorConfigInvalidError` otherwise); (2) a literal `human:<id>` entry in
`config.actors.humans` matching case-insensitively, config spelling returned
(glob entries are skipped); (3) `human:<email local part>`; (4) `human:<slug
of user.name>`; (5) `HumanActorUnresolvedError` (ruling P-13). Who may
verify is a separate gate; see [A non-empty actors list is an allow-list and
okfit never stores emails](actor-allow-list.md). The
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
already matches; derivation uses only the local part and never writes an
email address or domain into the bundle. Every concept in this
plan still hardcodes `generated: { by: human:spencer }` by hand rather than
invoking derivation. The first command to wire
`Derivation.generatedBy` into a write path is `okfit verify` (phase 2),
which stamps the resolved human actor into `verified`.
