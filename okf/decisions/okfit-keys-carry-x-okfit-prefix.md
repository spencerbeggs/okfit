---
type: Decision
title: okfit's own frontmatter keys carry the x-okfit- prefix
description: okfit names its integrity key and the 18 built-in software-project fields x-okfit-<name> in kebab case, as OKF v0.3 section 4.1 asks of a producer's keys, and moves old bundles with okfit sync alone, with no read-both period.
tags:
  - architecture
  - dx
sources:
  - resource: ../../packages/core/src/Integrity.ts
    title: INTEGRITY_KEY, the one place the integrity key is spelled.
  - resource: ../../packages/profiles/src/ProfileKeys.ts
    title: ProfileKeys, the one place each built-in profile field's key is spelled.
  - resource: ../../packages/engine/src/sync/legacyKeys.ts
    title: The only home of the old spellings, read by the sync migration.
generated:
  by: okfit/claude-code
  at: 2026-11-24T20:33:07Z
status: draft
x-okfit-integrity:
  generated:
    body: d3dae7c11c82a7a3
---

# okfit's own frontmatter keys carry the x-okfit- prefix

## Context

OKF v0.3 section 4.1 lets a producer add keys to a concept, promises that
future OKF versions will not define keys that start with `x-`, and asks
producers to name their own keys `x-<producer>-<name>`. okfit's keys were bare:
`integrity`, plus the 18 fields the software-project profile declares on its
built-in types (`kind`, `layer`, `pins`, `supersedes`, `bounds`, `repository`,
`gate`, `justifies`, `occurred`, `guard`, `audience`, `url`, `links_to`,
`surface`, `renders`, `entry`, `crosses`, `runbooks`). A later OKF version, or
another producer, could claim any of them. okfit is before 1.0.0 and nothing
outside this repository reads these keys, so the cost of moving them is lowest
now.

## Decision

**Every key okfit owns is `x-okfit-<name>`, in kebab case.** `integrity`
becomes `x-okfit-integrity`; each profile field becomes `x-okfit-<field>`, so
`links_to` is `x-okfit-links-to` and never `x-okfit-links_to`. There are two
sources of truth: `INTEGRITY_KEY` in `packages/core/src/Integrity.ts` and
`ProfileKeys` in `packages/profiles/src/ProfileKeys.ts`. The old spellings live
only in `packages/engine/src/sync/legacyKeys.ts`.

**What moves and what does not.** Only `integrity` and the 18 built-in profile
fields move. Fields a user declares in their own config are theirs to name.
Keys nested inside an okfit-owned mapping take no prefix, so a Publication's
entry is `x-okfit-renders[].body`. OKF's own keys do not move (`type`, `title`,
`description`, `resource`, `tags`, `sources`, `generated`, `verified`, `status`,
`stale_after`, `superseded_by`, `timestamp`, `okf_version`, `license`). The
derived signal `integrity: current|drifted|none` that query, MCP and the
editor report keeps its name; it is not a frontmatter key.

**No read-both period and no deprecation lint.** Old spellings are recognised
only by `okfit sync`, which renames the key token in place (quote style,
value, comments and order kept), reports the ids as `migrated`, and does
nothing on a second run. Until it runs, an unmigrated bundle reads as
unverified and its profile fields read as unknown extras.

**When sync renames a profile key.** Only where the merged config declares the
prefixed field for that concept's type and not the bare one. A custom type, a
`profile = "none"` project and a user's own bare field are left alone, and
config files are never edited. A concept carrying both spellings is skipped as
`legacy-key-conflict` with nothing written. A legacy key sync cannot rename in
place (a flow-style document, a flow or alias legacy block, an explicit `?`
key, a duplicated key) is skipped as `legacy-key-unsupported`. A key supplied
only through a YAML `<<` merge is not a key okfit reads, so it is left alone.
A concept sync cannot stamp (uncommitted edits, untracked, no `generated`)
still gets its keys renamed and is reported as both migrated and skipped; on
`--staged` that restages the whole file, as a stamp does.

**Verification stays refused on a legacy block.** `okfit verify`, the editor's
verify action and the migration `--fix` refuse a concept that still carries
the old integrity block and point at `okfit sync`, so none of them writes a
second block.

**Digests.** `x-okfit-integrity` is excluded from the content digest, and a
bare `integrity` no longer is, so a leftover or foreign `integrity` key counts
as authored content. Renaming `integrity` therefore changes no digest.
Renaming a profile key does change the content digest, because key names are
hashed, so a verified concept that carries one shows `verified-drift` until a
human re-verifies it. No tool rewrites `x-okfit-integrity.verified`. In this
bundle that was 8 concepts.

Decisions written before this one name the keys without the prefix; read them
as `x-okfit-integrity` and `x-okfit-<field>`.

## Alternatives rejected

- **A read-both period with a deprecation lint.** The first idea on the
  ticket. Nothing outside the repository reads these keys and okfit is before
  1.0.0, so a period of accepting both spellings would be code to maintain for
  no reader; the owner ruled it out.
- **One nested `x-okfit:` mapping.** It would break the flat
  `[types.<Name>.fields.<key>]` model, where a field is a top-level key, and
  the path-field lookup that finds link fields by key.
- **A digest alias that folds `x-okfit-kind` back to `kind`.** It would keep
  the old digests valid at the price of a permanent exception in the digest
  contract.
- **Renaming only `integrity`.** The profile's fields are just as much okfit's
  own keys, and leaving them bare keeps the collision risk.

## Consequences

Every verified concept that carried a profile key lost its current
verification when the keys moved, until its owner re-verifies it: 8 concepts
in this bundle. Prose that tells a reader what to write was updated to the new
names; Decisions that record a point in time were left as written. The
contract is in [integrity frontmatter](../interfaces/integrity-frontmatter.md)
and the family's rationale in [Every okfit digest lives in one integrity
family](integrity-family.md).
