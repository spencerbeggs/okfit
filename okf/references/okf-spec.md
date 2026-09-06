---
type: Reference
title: Open Knowledge Format v0.2 specification
description: Mirrored pointer to the upstream OKF v0.2 spec this repository's whole software-project profile targets, and to the sample bundles vendored as core's conformance fixtures.
status: stable
generated:
  by: human:spencer
sources:
  - resource: "https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md"
    title: "Open Knowledge Format (OKF) v0.2 specification"
  - resource: "packages/core/__test__/fixtures/okf"
    title: "Vendored upstream sample bundles (acme_retail, crypto_bitcoin, ga4, stackoverflow), Apache 2.0"
---

# Open Knowledge Format v0.2 specification

## What this mirrors

The upstream OKF v0.2 spec URL every profile, lint, and family in this
repository targets, plus the origin of the four sample bundles
`@okfit/core`'s tests vendor as conformance fixtures — the upstream sample
bundles named in spec §7 "Testing"
(`docs/superpowers/specs/2026-09-04-okfit-monorepo-design.md:409-411`).

## Why mirror it here

So a reader finds the spec URL and the fixtures' origin from inside the
bundle itself, without hunting through `packages/core/__test__/CLAUDE.md`
or gitignored research notes.

## What it does not cover

A pointer, not a transcription: the frontmatter field table, the
conformance floor, and the actor convention are the `okf-spec` skill's job,
not this concept's.
