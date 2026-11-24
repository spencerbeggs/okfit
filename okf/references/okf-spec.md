---
type: Reference
title: Open Knowledge Format v0.3 specification
description: Mirrored pointer to the upstream OKF v0.3 spec this repository targets, the v0.2 text okfit still reads, and the sample bundles vendored as core's conformance fixtures.
status: stable
generated:
  by: okfit/claude-code
  at: 2026-11-24T16:18:39Z
sources:
  - resource: "https://github.com/open-knowledge-format/open-knowledge-format/blob/main/SPEC.md"
    title: "Open Knowledge Format (OKF) v0.3 specification"
  - resource: "https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md"
    title: "Open Knowledge Format (OKF) v0.2 specification (earlier version okfit still reads)"
  - resource: "../../packages/core/__test__/fixtures/okf"
    title: "Vendored upstream sample bundles (acme_retail, crypto_bitcoin, ga4, stackoverflow), Apache 2.0"
integrity:
  generated:
    body: 2c6ab2cbaffcccb0
---

# Open Knowledge Format v0.3 specification

## What this mirrors

The upstream OKF v0.3 spec URL every profile, lint, and family in this
repository targets, with the v0.2 text kept for the legacy reading
(`OkfVersion.legacyFallbacks`, `packages/core/src/OkfVersion.ts`), plus the
origin of the four sample bundles `@okfit/core`'s tests vendor as conformance
fixtures — the upstream OKF v0.2 sample bundles
(`GoogleCloudPlatform/knowledge-catalog`, pinned in
`packages/core/__test__/fixtures/okf/VENDORED.md`).

## Why mirror it here

So a reader finds the spec URL and the fixtures' origin from inside the
bundle itself, without hunting through `packages/core/__test__/CLAUDE.md`
or gitignored research notes.

## What it does not cover

A pointer, not a transcription: the frontmatter field table, the
conformance floor, and the actor convention are the `okf-spec` skill's job,
not this concept's.
