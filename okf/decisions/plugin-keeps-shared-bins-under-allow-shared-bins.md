---
type: Decision
title: The carrier keeps its front ends' bin names, proven under allowSharedBins
description: "@okfit/plugin declares okfit, okfit-mcp and okfit-lsp although @okfit/cli, @okfit/mcp and @okfit/lsp declare the same names, and the packed-install e2e passes allowSharedBins and proves the carrier's own shims instead of moving to carrier-only bins."
status: draft
tags:
  - architecture
  - testing
sources:
  - id: packed-install-test
    resource: ../../packages/plugin/__test__/e2e/packed-install.e2e.test.ts
  - id: issue-191
    resource: https://github.com/spencerbeggs/okfit/issues/191
generated:
  by: okfit/claude-code
  at: 2026-10-05T16:53:52Z
  body_sha256: d5c7d979faaea49d991efa840ebd09b807f00994e616cc53e0b4cfee11cf7d3e
---

# The carrier keeps its front ends' bin names, proven under allowSharedBins

## Context

The kit's recommended carrier shape lets only the carrier declare bins. okfit
does the opposite: each front end package (`@okfit/cli`, `@okfit/mcp`,
`@okfit/lsp`) ships its own bin so it works installed alone, and
`@okfit/plugin` re-declares the same three names so one install gives all
three bins and a report learns `distribution: @okfit/plugin`. Under npm and
bun's flat layout either package can take the `.bin` slot.

## Decision

Keep the shared names. No bin is removed, no loader changes. The packed-install
suite passes `allowSharedBins: true`, proves what a user typing the bin name
gets with `runBin`, proves the carrier's own shim with `runCarrierBin` and
`carrierCommand` (the `via @okfit/plugin` suffix, the `distribution` stamp, an
MCP and an LSP handshake), and pins who owns each slot with `binProvenance`:
npm and bun link the front end, Yarn keeps the carrier, pnpm writes shell
shims.

## Alternatives rejected

- Carrier-only bins. A front end installed alone would have no bin, and the
  Claude Code plugin loaders and `npx -p` fallbacks rely on the direct names.
- Dropping the carrier's declarations. The `via @okfit/plugin` identity would
  then be reachable only through a bin that no manager promises to link.

## Consequences

- Under npm and bun the bare `okfit` a user types may be the front end's, which
  reports `distribution: null`; the carrier's shim is the one that stamps it.
  The provenance table in the test is the record of that and fails if a manager
  changes who wins a slot.
- `@okfit/cli` and `@okfit/mcp` also have their own one-carrier packed smoke
  suites, where the package is the sole declarer.
