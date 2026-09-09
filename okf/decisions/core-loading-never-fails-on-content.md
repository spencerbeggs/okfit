---
type: Decision
title: Loading never fails a concept for a bad family
description: Bundle.load never rejects a concept outright for a malformed optional field; a bad family is reported as a lint diagnostic while the rest of the concept still loads.
tags:
  - architecture
generated:
  by: human:spencer
  at: 2026-09-06T11:25:53Z
  body_sha256: b6c556399344766d78933222a1d843d3a96c5c47ddfedf78ff61437b1c8c7db5
status: stable
verified:
  - by: human:spencer
    at: 2026-09-07T20:49:07Z
---

# Loading never fails a concept for a bad family

## Context

A concept's frontmatter has one always-required key (`type`) and many
optional families (`title`, `resource`, `tags`, `sources`, `generated`,
`verified`, `status`, `stale_after`, the computation family); core had to
decide what happens to the whole concept when one of those optional families
is malformed — a bad date string, an offset-less timestamp, a wrong shape.

## Decision

Loading is a two-stage decode. Stage 1 (`ConceptEnvelope`) requires only a
non-empty `type` string; failure there is the conformance error
`type-missing`. Stage 2 decodes each optional family independently; a family
that fails to decode is omitted from the typed concept (its raw value stays
under `raw`) and produces the lint diagnostic `family-invalid` (default
severity `error`) with the schema issue and frontmatter range
(ruling D-15).

## Alternatives rejected

One strict `Schema.decode` over the whole frontmatter object would reject
the entire concept — dropping it from `concepts`, the graph, and every index
— for a single malformed optional field, contradicting core's own stated
rule that "loading never fails on content" (`packages/core/CLAUDE.md`) and
turning one typo in, say, `sources[].last_modified` into the disappearance
of an otherwise-good concept.

## Consequences

A bad family surfaces as one `family-invalid` lint diagnostic pointing at
the exact frontmatter range, while the concept keeps its `type`, every other
successfully decoded field, and its place in the link graph and every
`index.md`; unknown keys are preserved the same tolerant way, under
`extensions`.
