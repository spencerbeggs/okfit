---
type: Decision
title: The software-project vocabulary grows from what migrations could not express
description: Five types (Runbook, Glossary, Limitation, DataModel, Gotcha), three tags (dx, ci, compat), and structured Module and Interface fields were added to the software-project profile because three real migrations had to contort the same kinds of knowledge into the original six types.
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-13T03:51:46Z
  body_sha256: 661f1ae0554cd71c8d48a1c57394098d267e48dc2c526e7f39df76546240eea9
status: stable
verified:
  - by: human:spencer
    at: 2026-09-13T04:13:10Z
---

# The software-project vocabulary grows from what migrations could not express

## Context

The `software-project` profile shipped with six types (`Project`,
`Module`, `Decision`, `Convention`, `Interface`, `Reference`) and five
tags. Migrating three real repositories onto it through `/okfit-migrate`
(rolldown-pnpm-config at 56 concepts, spencerbeggs/website at 13,
savvy-web/systems) produced the same friction each time, filed as
[#35](https://github.com/spencerbeggs/okfit/issues/35) through
[#39](https://github.com/spencerbeggs/okfit/issues/39),
[#46](https://github.com/spencerbeggs/okfit/issues/46),
[#60](https://github.com/spencerbeggs/okfit/issues/60) through
[#62](https://github.com/spencerbeggs/okfit/issues/62): an ordered release
procedure forced into `Convention`'s imperative-rule shape with a staleness
cadence it does not want; a repo-private glossary squeezed into
`Reference`, which is defined as mirrored *external* material; a known
edge of a contract buried as a trailing paragraph of an `Interface`; an
internal source-of-truth table documented "from the consumer's side"
because `Interface` was the only home; and a trap ("this looks broken but
is transient", "this reports success and did nothing") phrased as a rule
because no type says "this will fool you". Two of the three repositories
had already added the missing types to their own config by the time the
tickets were filed, and reported that the split worked cleanly in
practice.

The same migrations found `Module.kind` had no value for a private test
harness or a pnpm config dependency, `Interface.kind` none for a runtime
binding a consumer invokes rather than a shape they write, and no
structured way to say which layer a module sits in or which siblings it is
exact-version-pinned with.

## Decision

Grow the profile rather than leave each repository to re-derive the same
extensions:

- **Five new types**: `Runbook` (ordered steps, a trigger, an observable
  end state), `Glossary` (one term per concept, earned on a collision or a
  trap), `Limitation` (a known edge, with a `bounds` path to the Interface
  or Module it bounds), `DataModel` (`resource` required; documented from
  the maintainer's side), and `Gotcha` (a misleading signal, with a
  `resource` and a staleness window). Each gets a layout directory so
  `okfit init` scaffolds it.
- **Gotcha stays distinct from Limitation.** A limitation is "this cannot
  do X"; a gotcha is "this looks like X and is the opposite". Folding them
  would make the enumerable question "what are the known edges of this
  system" return transient-state warnings alongside real boundaries.
- **Three new tags**: `dx`, `ci`, `compat`.
- **Enum values**: `Module.kind` gains `harness` and `config-dependency`;
  `Interface.kind` gains `runtime`.
- **Two optional Module fields**: `layer` is free text (a repository's
  layering scheme is its own, so an enum would be wrong for every repo but
  one) and `pins` is a `path`-kind list of sibling Modules. Core validates
  neither beyond presence, exactly as `resource` is treated today.
- **A draft Decision is exempt from `require-verified-unmet`**
  ([#31](https://github.com/spencerbeggs/okfit/issues/31)). A draft is
  unsettled by definition, and a freshly migrated bundle is entirely
  drafts, so without the exemption the migration's own "validate clean
  before cleanup" gate was unreachable by construction.

## Alternatives rejected

- **Leave the six types and let each repo extend its config.** That is
  what the migrations did, and the point of a profile is that three repos
  should not each rediscover `Runbook`. The tickets were filed precisely
  because the extensions were judged general, not repo-specific.
- **One `Note` catch-all type.** It would absorb everything the six could
  not express and make none of it queryable; the value of `Limitation` and
  `Gotcha` is that a reader can enumerate them.
- **Default `require_verified_unmet` to `warn` in the profile.** Fixes the
  migration gate but weakens the rule for stable Decisions too. Scoping
  the lint to non-draft concepts keeps `error` where it means something.
- **A `layer` enum (`L0`..`L4`).** Only one repository's scheme; a second
  repository with named tiers would be wrong on arrival.

## Consequences

- `okfit init` now scaffolds ten directories. Existing bundles are
  untouched: the new types are available, not required, and nothing lints
  a bundle for not using them.
- The vocabulary is reproduced in `packages/profiles/README.md`'s TOML
  fence (a test fixture), the `okf-config` skill, the clean fixture bundle
  under `packages/profiles/__test__/fixtures/software-project`, and the
  `okfit-migrate` mapping table; all four move together.
- `okfit context` and `describe_vocabulary` now carry each type's
  `required`, `require_verified`, and `fields` with their enum values
  ([#33](https://github.com/spencerbeggs/okfit/issues/33)), so an agent
  learns what a valid concept needs before writing one instead of from a
  lint error afterwards.
