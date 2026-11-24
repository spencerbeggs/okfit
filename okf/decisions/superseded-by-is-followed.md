---
type: Decision
title: A deprecated concept's replacement is followed
description: superseded_by is a path field, two core lints check it, Graph.replacement walks the chain to the first current concept, and the query layer exposes it as a current filter and a replacement; okfit context does not follow it and the profile declares no field for it.
tags:
  - architecture
sources:
  - resource: ../../packages/core/src/Graph.ts
    title: Graph.replacement.
  - resource: ../../packages/core/src/internal/lintRules.ts
    title: The superseded-by-orphan and superseded-by-unresolved rules.
  - resource: ../../packages/engine/src/move/references.ts
    title: The path fields okfit mv rewrites, superseded_by among them.
  - resource: ../../packages/engine/src/query/ConceptQuery.ts
    title: The current filter and the replacement on get.
generated:
  by: okfit/claude-code
  at: 2026-11-24T20:41:11Z
status: stable
x-okfit-integrity:
  generated:
    body: ecf8d5337fc93e11
  verified:
    by: human:spencer
    at: 2026-11-24T22:21:07Z
    content: c8bcf7e37d72b2fd
verified:
  - by: human:spencer
    at: 2026-11-24T03:27:42Z
  - by: human:spencer
    at: 2026-11-24T22:21:07Z
---

# A deprecated concept's replacement is followed

## Context

OKF v0.3 §5.4 lets a deprecated concept name its replacement in
`superseded_by`, and §6 makes it a path field, so the link is part of the
graph. A consumer that wants current knowledge has to know which concept
replaced a deprecated one. Core already reads `superseded_by` as a typed
string and a graph edge (see [Loading never fails a concept for a bad
family](content-tolerant-loading.md)); this Decision covers what okfit does
with it.

## Decision

- **Two lints, both `warn`.** `superseded-by-orphan` fires on a concept that
  carries `superseded_by` without `status: deprecated`, because the key has a
  meaning only on a deprecated concept. `superseded-by-unresolved` fires on a
  deprecated concept whose value resolves to something that is not a
  replacement concept: an asset, an external value (a URL, or a path that
  leaves the bundle) or the concept itself. A target that does not exist stays
  `broken-links`: that lint already reports a missing target for every path
  field, and a second code for the same cause would say it twice.
- **`Graph.replacement(bundle, id)`** walks `superseded_by` from a deprecated
  concept through deprecated concepts and returns the first concept whose
  derived status is `draft` or `stable`. It resolves each hop with the same
  resolver the lint uses, so the version gate applies. It returns nothing for
  a concept that is not deprecated, a missing or non-concept target, a cycle
  or a self-link, or a chain that ends at an unknown-status concept.
- **The query layer exposes it.** `ConceptFilter.current` keeps draft and
  stable concepts and drops deprecated and unknown-status ones, intersected
  with `statuses`; because `replacement` only ever returns a draft or stable
  concept, a replacement is listed whenever it passes the other filters.
  `ConceptQuery.get` returns `replacement`, which `okfit query get` and the MCP
  `get_concept` tool show; `query list` summaries and `list_concepts` do not
  carry it.
- **`okfit context` is unchanged.** Following `superseded_by` lives in the
  query layer, behind `okfit query` and the MCP tools, not in the orientation
  command.
- **`okfit mv` rewrites it.** `superseded_by` is one of the path fields
  `okfit mv` rewrites, so renaming a successor leaves no dangling link.
- **No profile field.** The software-project profile declares no
  `superseded_by` field. It is a spec key that core already reads as a path
  field, and a declared path field with the same name would be listed twice
  by `mv`. The Decision guidance names `superseded_by` on the deprecated
  Decision and `x-okfit-supersedes` on its successor instead. The prefix is explained in
[okfit's keys carry the x-okfit- prefix](okfit-keys-carry-x-okfit-prefix.md).

## Alternatives rejected

Letting `current` add a replacement to the result when it fails the other
filters would contradict a `types` filter the caller wrote. Declaring
`superseded_by` as a profile field would document it where authors look but
duplicate an edge core already owns. A single lint for both problems would
force one severity on two different mistakes; a missing target already has its
own code. Following the chain in `okfit context` would put graph work in the command a hook calls on every write.

## Consequences

A caller that wants current knowledge passes `--current` or `current: true`
and reads `replacement` to find where a deprecated concept went. A chain that
ends at a draft concept reports that draft as the replacement, because a
draft is current by the spec's reading. This bundle's own deprecated Decisions
carry no `superseded_by` yet, so the lints are silent here.
