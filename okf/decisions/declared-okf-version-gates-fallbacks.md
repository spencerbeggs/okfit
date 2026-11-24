---
type: Decision
title: The declared OKF version gates the v0.2 fallbacks
description: A bundle's root index.md okf_version decides, through one gate in core, whether bare paths may fall back to the bundle root and how a computation is located; a bundle that declares 0.3 or later gets the strict v0.3 rules.
tags:
  - architecture
sources:
  - resource: ../../packages/core/src/OkfVersion.ts
    title: The version parser, the comparison and the single gate.
  - resource: ../../packages/core/src/Bundle.ts
    title: The computation locator that reads the gate.
  - resource: ../../packages/core/src/internal/links.ts
    title: The root fallback that reads the gate.
generated:
  by: okfit/claude-code
  at: 2026-11-24T16:18:39Z
status: stable
integrity:
  generated:
    body: 2b9b94c00742b26a
  verified:
    by: human:spencer
    at: 2026-11-24T14:56:24Z
    content: be165a51d11802e9
verified:
  - by: human:spencer
    at: 2026-11-23T22:18:45Z
  - by: human:spencer
    at: 2026-11-24T02:55:14Z
  - by: human:spencer
    at: 2026-11-24T14:56:24Z
---

# The declared OKF version gates the v0.2 fallbacks

## Context

OKF v0.3 §6.2 resolves a bare path value (no `./`, `../` or `/`) from the
file's own directory only. OKF v0.2 bundles, including this one until it declared 0.3, relied on a second try from the bundle root. §10.3 also changed how a
computation is found: v0.3 names the first fenced code block of the
`Computation` section, where v0.2 had no locator rule and okfit kept the
whole depth-1 section body. Applying the v0.3 rules to every bundle would
break bundles that okfit already accepted, so core needs to know which rules
a bundle follows.

## Decision

The declared version is the `okf_version` of the bundle-root `index.md`
(`OkfVersion.declared`). It is read as exactly `<major>.<minor>`
(`OkfVersion.parse`; no `v`, no patch, no whitespace) and compared
numerically, major first, so `0.10` sorts after `0.9` (`OkfVersion.compare`).

One gate, `OkfVersion.legacyFallbacks(bundle)`, answers whether the v0.2
fallbacks apply. It is true when the bundle declares no version, or declares
0.2 or earlier. It is false when the bundle declares 0.3 or later, and also
when the declared value does not parse: an unparsable version reads as
current, best effort as §12 asks, and the root index load reports it as
`index-metadata-invalid`. Both fallbacks read this one gate:

- **Root fallback.** `Graph.fromBundle` builds its lookup with
  `rootFallback` set from the gate. When it is false, a bare value for a
  link or a path field resolves from the file's directory only. When it is
  true, the old second try from the bundle root stays, for links and path
  fields alike. §6.2 names only path fields for the fallback; keeping it for
  links in old bundles is okfit being lenient to bundles it already accepted.
- **Computation locator.** For a bundle that declares 0.3 or later,
  `computationBody` is the code of the first fenced block among the direct
  children of the first `Computation` section, at any heading level. No
  fence means no computation; an empty fence yields an empty string. A fence
  counts only when it opens with three backticks or tildes after at most
  three spaces of indentation, so an indented code block is not a fence. The locator looks only at the
  root-level blocks of the `Computation` section and of its subsections, so a
  fence nested inside a list item or a block quote is not found. For
  a bundle declaring 0.2 or earlier, or nothing, `computationBody` stays the
  body of the depth-1 `Computation` section.

`computationBody` is the inline form only. When `attested.computation` names
a file, §10.3 says that file is the computation; core does not read it,
because nothing downstream consumes the computation text yet.

The config key `okf_version` plays no part in the gate. It only fills what
okfit writes: `init` writes it, or the spec constant `OKF_SPEC_VERSION`
(`"0.3"`) when the config sets none, and `sync` adds it only to a root index
that declares none and only from an explicit config key, so raising the spec
constant never moves an undeclared bundle to v0.3 resolution. `DEFAULTS` has
no `okf_version` for that reason. The JSON envelopes of `validate`, `lint`,
`graph` and `stale`, and the MCP `validate_bundle` result, report the bundle's
own declaration as `okf_version`, or `null` when it declares none; the old
warning that the config and the constant disagreed is gone, because the
config no longer names what a bundle is.

## The migration report reads both rules

`Graph.resolve` takes a third argument, the fallback rule: `"declared"`
(the default, what the bundle's own declaration says), `"legacy"` or
`"current"`. `Bundle.inlineComputation(document, rule)` does the same for
the computation locator. The migration report of `okfit validate --target`
([Migration is a report](migration-is-a-report.md)) resolves each reference
under `"legacy"` and `"current"` and compares, which is how it finds a bare
value that resolves only from the bundle root even in a bundle that already
declares 0.3. Nothing else passes a rule; every other caller still reads
the declared one.

## Alternatives rejected

Applying the v0.3 rules to every bundle would turn each v0.2 bundle that
resolves a bare value from the root into a wall of `broken-links` warnings
the day okfit upgrades. Reading the version from the config instead of the
bundle would let two checkouts of one bundle disagree, and the version is
per bundle, not per project. Keeping a separate gate for each fallback
invites the two to disagree; one function means a bundle is either legacy or
current.

## Consequences

A bundle migrates by raising its declared version, which is a bundle edit
and not an okfit switch. A bundle that declares nothing keeps the old
behaviour indefinitely, so nothing existing breaks. Every new
version-dependent rule asks `OkfVersion.legacyFallbacks` rather than
comparing versions itself. The engine's cited-resource check
reads the same gate: `resourceCandidates` (`validate/repository.ts`) tries
the bundle root for a bare value only while `legacyFallbacks` holds (see
[Repository resources are classified by where they
resolve](repository-resources.md)). `Publications.resolveRef` in
`@okfit/profiles` has no root fallback at all, a difference from core listed
in its TSDoc.
