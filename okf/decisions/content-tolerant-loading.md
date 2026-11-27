---
type: Decision
title: Loading never fails a concept for a bad family
description: Bundle.load never rejects a concept outright for a malformed optional field; a bad family is reported as a lint diagnostic while the rest of the concept still loads.
tags:
  - architecture
generated:
  by: human:spencer
  at: 2026-11-27T20:43:45Z
status: stable
verified:
  - by: human:spencer
    at: 2026-09-07T20:49:07Z
  - by: human:spencer
    at: 2026-10-11T14:21:44Z
  - by: human:spencer
    at: 2026-11-23T22:13:15Z
  - by: human:spencer
    at: 2026-11-24T02:55:14Z
  - by: human:spencer
    at: 2026-11-24T22:21:07Z
x-okfit-integrity:
  generated:
    body: 7f8d606322fc067d
  verified:
    by: human:spencer
    at: 2026-11-24T22:21:07Z
    content: 26501615068f6a1d
---

# Loading never fails a concept for a bad family

## Context

A concept's frontmatter has one always-required key (`type`) and many
optional families (`title`, `resource`, `tags`, `sources`, `generated`,
`verified`, `status`, `stale_after`, `superseded_by`, the computation
family); core had to decide what happens to the whole concept when one of
those is malformed -- a bad date string, an offset-less timestamp, a wrong
shape. OKF v0.3 §11.2 answers it for consumers: read key by key, and report
instead of failing.

## Decision

Loading never rejects a concept, and a bad value never drops more than it
has to. The reading follows §11.2 rule by rule:

1. `null`, `""` and `[]` read as absent, in decode and in `Derive.status`
   and `Derive.staleness` alike.
2. One item where a list is expected reads as a list of one, for exactly the
   four fields §11.2 names: `tags`, `sources`, `verified` and `parameters`.
   A scalar `executor.receipt` is therefore `value-malformed`, not a list of
   one: the rule does not name it. The key is dropped and the executor kept.
3. A list is decoded entry by entry. An entry that lacks its required key
   (`resource` for a source, `by` and `at` for a verification, `by` for
   `generated`, `name` and `type` for a parameter) or whose required key is
   unreadable is dropped, with `entry-ignored`. Any other malformed key
   drops only that key, with `value-malformed`. `sources: 5` is
   `entry-ignored`: it reads as a list of one entry that has no `resource`.
   Keys a class does not declare are never read.
4. A defined key whose value is outside its vocabulary is kept and reported
   with `value-unknown`. Today that is `status`: the typed `Concept.status`
   stays `draft | stable | deprecated`, and `Derive.status` returns the
   wider `DerivedStatus`, which adds `unknown`. `Derive.rawStatus` returns
   the value as written. An unknown status is excluded from current
   knowledge and never read as `stable`.

A single mapping family (`usage_window`, `executor`, `attester`) whose every
written known key was dropped reads as absent, with the per-key warnings kept,
even when it also has unknown keys: an unknown key is never read, so it never
keeps a mapping present. A mapping with nothing dropped, written as `{}` or
holding only unknown keys, is kept. A source's own `usage_window` decodes key
by key like the top-level one, so a good key beside a bad one is kept.

All three codes are lint codes with default severity `warn`; none fails
conformance. The concept keeps its place in the graph and every index.

`stale_after` that cannot be read is `value-malformed`, and
`Derive.staleness` returns `malformed` for it: never fresh, never stale.
Timestamps accept a date-only `YYYY-MM-DD`, read as the start of that day
in UTC; an impossible calendar day is malformed. okfit still writes full
date-times. `superseded_by` is a typed string field, a sixth path field and
a graph edge (see the Core module).

Because a dropped entry shifts later entries, a kept entry's decoded index
is no longer its YAML index. `Concept.entries` (`EntryPaths`) records the
YAML path of each kept `tags`, `sources`, `verified` and `parameters`
entry, and `Concept.entryPath` returns it. Every diagnostic range and
path-field path for those families comes from there; a single bare mapping
records the path of the key itself.

The computation family decodes key by key as well: a bad `executor` no
longer drops `runtime`, and `executor.resource`, `executor.receipt`,
`attester.resource`, `usage_window.from` and `usage_window.to` are optional.
`computation-runtime-missing` (error) fires whenever the decoded
`runtime` is absent, which includes a `runtime` that is present but
unreadable, because §10.2 forbids showing a value as attested without it.

An empty required key follows rule 1 too. `required-key-missing` treats a key
written as null, `""` or `[]` as absent and says "is empty" where an unwritten
key says "is missing", ranged at the key's own line. The same test decides
`field-value-unknown` (an empty value is absent, not an unknown value) and
`generated-missing` (a `generated` written as null, `""` or `[]` counts as no
block, and so does one the decoder ignores for want of a readable `by`, such as
`{}`; the lint says to set `generated.by` by hand, as sync creates only a block
that is not written, and a legacy `timestamp` alone draws the same kind of
message).

`family-invalid` is narrowed to okfit's own `x-okfit-integrity` family, which still
decodes whole. See [okfit's keys carry the x-okfit- prefix](okfit-keys-carry-x-okfit-prefix.md) for the name. `frontmatter-missing` and `type-missing` left the conformance
tier (see the non-concept-markdown Decision); a frontmatter block that is
not a mapping is the conformance error `frontmatter-unparseable`.

## Alternatives rejected

One strict `Schema.decode` over the whole frontmatter object would reject
the entire concept -- dropping it from `concepts`, the graph, and every
index -- for a single malformed optional field, contradicting core's own
stated rule that "loading never fails on content"
(`packages/core/CLAUDE.md`). Decoding each family whole, as this Decision
did before, still lost a whole `sources` list for one entry without a
`resource`. Reading a scalar `executor.receipt` as a list of one would go
beyond §11.2 rule 2.

## Consequences

One bad entry now costs one entry and one warning. When the ignored entry was the only `verified` entry, the concept is left
with none, so a type that sets `require_verified` reports `require-verified-unmet` for it: a
warning about the entry and an error about the missing verification.
Consumers must not index into YAML with a decoded index; they use
`Concept.entryPath`. Unknown keys are preserved the same tolerant way, under
`extensions`.
