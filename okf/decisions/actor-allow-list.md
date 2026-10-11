---
type: Decision
title: A non-empty actors list is an allow-list and okfit never stores emails
description: A non-empty [actors].humans list gates who may verify, matched by id or glob without emails, and okfit.actor in git config names the explicit id.
tags:
  - security
generated:
  by: okfit/claude-code
  at: 2026-10-11T16:51:30Z
status: draft
sources:
  - id: derivation-ts
    resource: ../../packages/profiles/src/Derivation.ts
integrity:
  generated:
    body: 49cf4e05418e7493
---

# A non-empty actors list is an allow-list and okfit never stores emails

## Context

Issue 12 proposed `hint`, `allow` and `only` modes for `[actors].humans` and
matching verifiers by email address.

## Decision

There are no modes. An empty or absent `[actors].humans` allows any resolved
identity. A non-empty list, of exact `human:<id>` ids or globs using `*` and
`?` (case-insensitive), gates `okfit verify` and `--revoke`, which fail with
`HumanActorNotAllowedError`, and the trust signal, which reports
`actor-not-allowed`. `git config okfit.actor` is the explicit id and is read
first. Derivation keeps only the email local part, so no address is ever
written.[^derivation-ts]

## Alternatives rejected

Modes would give three behaviours where one list suffices. Email matching
would put personal addresses in a committed file. Rejecting `@` in the
`Actor` schema would turn a mistake into a decode failure that drops the
whole `verified` family and silently demotes the concept to unverified, so
it is a lint instead.

## Consequences

Two new lints, `actor-email` and `verified-actor-unknown`, both default
`warn`. Git commit history is outside okfit's reach, so recommend a GitHub
`noreply` author address to anyone who does not want an email in it.

See [A verification is bound to the content it covered](verification-binds-content.md),
[Verification drift is a signal to weigh, never a gate](drift-is-a-signal.md)
and [Human actor ids resolve through a five-step fallback order](profiles-human-actor-resolution.md).

[^derivation-ts]: `../../packages/profiles/src/Derivation.ts`
