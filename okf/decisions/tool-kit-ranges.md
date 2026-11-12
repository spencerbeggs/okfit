---
type: Decision
title: Tool packages pin the kit exactly; libraries keep carets and peers
description: "@okfit/cli, @okfit/mcp, @okfit/lsp and @okfit/engine write every effect, @effect/* and @effected/* runtime dependency as catalog:effected:exact, so an installed okfit owns the kit it was tested with; @okfit/core and @okfit/profiles stay libraries with caret peers."
tags:
  - deps
  - release
status: draft
sources:
  - id: tool-kit-pins-test
    resource: ../../packages/plugin/__test__/toolKitPins.test.ts
  - id: cli-manifest
    resource: ../../packages/cli/package.json
  - id: carrier-closure
    resource: "npm:@effected/pnpm-plugin-effected"
generated:
  by: okfit/claude-code
  at: 2026-11-12T02:37:58Z
integrity:
  generated:
    body: 9a6edb3eeca4000e
---

# Tool packages pin the kit exactly; libraries keep carets and peers

## Context

okfit's runnable packages took the kit through `catalog:effected`, which
publishes a caret on every `@effected/*` package. On `0.x` a caret floats
the patch, so a fresh install of a released okfit could pick up a kit
patch published after that release: okfit's behaviour moved under the
same version, and a kit library inside okfit's closure could take a peer
from another release line and die at import with `does not provide an
export named …`. Tools such as silk and vitest-agent hit exactly this in
okfit's own tree, which is why each kit round needed an override bridge.

## Decision

A package that runs is a tool and owns its kit closure. The carrier
`@okfit/plugin`, the front ends `@okfit/cli`, `@okfit/mcp` and
`@okfit/lsp`, and `@okfit/engine` beneath them write every `effect`,
`@effect/*` and `@effected/*` runtime dependency as
`catalog:effected:exact`[^cli-manifest]. The catalog plugin serves that
catalog as `effected` with every operator stripped, so the published
manifest names exact versions and still moves with each plugin
bump[^carrier-closure]. The carrier itself reaches the kit only through
the front ends, so it declares no kit dependency of its own.

`@okfit/core` and `@okfit/profiles` are libraries the engine imports and
share services and schemas with it. They keep `catalog:effected:peers`
carets, and the tools above them declare every kit peer they need as an
exact regular dependency, so the peers resolve to the tool's pins.

A unit test reads the tool manifests and fails on any kit runtime
dependency not written `catalog:effected:exact`, and on any package that
ships a `bin` without being listed as a tool[^tool-kit-pins-test].

## Alternatives rejected

**Keep carets and bridge with overrides in each consumer.** This puts the
cost on every repository that installs okfit, once per kit round, and
leaves okfit's behaviour changing between its own releases.

**Bundle the closure into `dist`.** That is the full seal, since nothing
would resolve at install time, but it gives up the per-package front-end
installs and the packed-install proof the carrier's e2e suite runs today.

## Consequences

- An okfit release on an older kit keeps working beside a host that has
  moved to a newer Effect or kit release. Duplicate kit copies in that
  host's tree are expected and harmless, since okfit shares no tag,
  schema or brand with it.
- Every kit release okfit adopts ripples a patch through the tool
  packages, and their changesets list exact versions.
- A kit library's own regular kit dependencies still float within their
  carets; only its peers come from the tool. A graph-wide `effect` pin in
  a host still overrides okfit's.
- A new runnable package must be added to the test's tool list, or the
  test fails.

[^tool-kit-pins-test]: `packages/plugin/__test__/toolKitPins.test.ts`
[^cli-manifest]: `packages/cli/package.json`
[^carrier-closure]: The effected kit's carrier-closure rule, shipped with `@effected/pnpm-plugin-effected` 0.26.2 as upgrade ledger entry 0011.
