---
type: Decision
title: An unknown status is not current knowledge
description: A status outside draft, stable and deprecated is kept and shown as unknown, never read as stable; every surface excludes it from current knowledge and okfit verify refuses to attest it, except when the same write sets the status.
tags:
  - architecture
sources:
  - resource: ../../packages/core/src/Derive.ts
    title: Derive.status and Derive.rawStatus.
  - resource: ../../packages/engine/src/verify/run.ts
    title: The verify refusal and its one exception.
  - resource: ../../packages/engine/src/verify/select.ts
    title: Batch, picker and stale selection that skip an unknown status.
  - resource: ../../packages/lsp/src/features/edits.ts
    title: The editor's derived status and its refusal.
generated:
  by: okfit/claude-code
  at: 2026-11-25T15:19:00Z
status: stable
x-okfit-integrity:
  generated:
    body: 3a11c640ca6775dd
  verified:
    by: human:spencer
    at: 2026-11-24T03:27:27Z
    content: 3f376c9ada5e62f1
verified:
  - by: human:spencer
    at: 2026-11-24T03:27:27Z
---

# An unknown status is not current knowledge

## Context

OKF v0.3 §5.4 names three statuses, `draft`, `stable` and `deprecated`, and an
absent `status` reads as `stable`. A concept can still carry any other value,
for example `status: archived`, and §11.2 says a consumer keeps it and
reports it instead of failing. [Loading never fails a concept for a bad
family](content-tolerant-loading.md) records that core keeps the value and
warns. What every other surface does with it is a separate question: before
this Decision the typed `Concept.status` dropped an unknown value, so every
reader that looked at it saw an absent status and read the concept as
`stable`, and `okfit verify` could attest a concept whose lifecycle state
nobody knew.

## Decision

An unknown status is not current knowledge, and no surface reads it as
`stable`.

- **In core.** `Concept.status` stays the three-value type so writers do not
  change. `Derive.status` returns `DerivedStatus`, which adds `unknown`, and
  `Derive.rawStatus` returns the value as written.
- **On the wire.** A summary's `status` is the derived status and `raw_status`
  holds the value as written, non-null only when `status` is `unknown`
  (`rawStatusOf` in the engine; a non-string is its JSON text, so `5` is
  `"5"`). The text form is `unknown(<raw>)`, in the CLI, and in the VS Code
  tree. The language server's concepts wire carries `status` and `rawStatus`.
  `okfit query --status unknown` and the MCP `status: "unknown"` filter select
  these concepts, and `--current` excludes them.
- **`okfit verify` refuses it.** Attesting a concept says its content is
  right; with an unknown status nobody can say what that content claims.
  `prepareVerify` fails with `VerifyStatusUnknownError` (exit `3`) before the
  drift diff and the confirm prompt. Batch selection, the picker and `stale
  --verify` skip such a concept (`unknown-status` is a batch skip reason), and
  so does an id list that holds one: it is skipped, checked before the
  not-current rule, and never verified or written, while the rest are verified.
  Only `okfit verify <one id>` refuses it with the error.
- **One exception.** `okfit verify <id> --stable` or `--draft` proceeds,
  because the same write replaces the status, so the human who names the flag
  is repairing the concept, not attesting an unknown state.
- **The editor has no exception.** The language server offers only the `Set
  status` actions for an unknown status and no verify action, and the
  `verifyAndMarkStable` command refuses it with
  `UnknownStatusCannotBeVerified`: nothing in the editor names the new status
  first.
- **`verified-drift` skips it.** The lint's remedy is `okfit verify`, which
  refuses, so reporting drift on an unknown-status concept would point at an
  action that cannot be taken.

## Alternatives rejected

Reading an unknown status as `stable` is the spec's reading of an absent
status, and it would let a misspelled `staable` count as current and
verifiable. Reading it as `draft` would hide it from the same filters in a
different direction. Dropping the concept from the graph, as a missing `type`
does, would lose it for a mistake that one edit fixes. Widening the typed
`Concept.status` to a string would change every writer for a case only a
reader needs. Letting `verify` proceed with a warning would make the trust
write the place where the mistake is discovered; refusing it points the
author at the one-line fix.

## Consequences

Every reader of status must read the derived status, not the typed field; a
reader that handles raw YAML, such as the language server's edit code, holds a
copy of the derivation (`derivedStatusOf`), and a test runs both over the same
table so they cannot drift. The VS Code extension does not import core and
reads a concept summary with no `status` at all, which only a language server
older than this field sends, as `stable`; that is a compatibility shim, not a
rule. The CLI exception means a human can attest an unknown-status concept in
one command; the editor is stricter on purpose.
