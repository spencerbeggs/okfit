---
type: Decision
title: Verification drift is a signal to weigh, never a gate
description: The verified-drift lint defaults to warn and no default config makes an edit fail CI; users who want enforcement raise the lint level or add their own hooks.
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-10-11T03:59:59Z
status: draft
sources:
  - id: design-spec
    resource: ../../docs/superpowers/specs/2026-10-10-okfit-verification-integrity-design.md
integrity:
  generated:
    body: 0c57f97e443b429c
---

# Verification drift is a signal to weigh, never a gate

## Context

okfit's job is to tell an agent how much to value each concept while keeping
concepts easy to edit. A rule that forbade editing verified concepts
discouraged the edits that keep a bundle true, and it could not be checked.
[Verification binds the content it
covered](verification-binds-content.md) makes the check possible.

## Decision

Editing a verified concept is allowed for anyone, of any type. The edit
turns the verification drifted; `okfit validate` reports the `verified-drift`
lint at `warn`, carried by `okfit validate` and the MCP `validate_bundle`
tool, beside the unchanged trust tier. Drift fields on MCP, LSP and VS Code
surfaces and `query` filters are planned for a later phase. A human re-runs `okfit verify` to re-bind.
Deprecate and supersede a Decision only when the choice itself changes.
Staleness (`stale_after`) stays a separate, parallel signal.

okfit does not gate: no default makes drift fail CI. A user who wants that
sets `verified_drift = "error"` or writes their own hook.

## Alternatives rejected

- Block edits to verified concepts. Enforcement belongs to the user's
  hooks, not to okfit.
- Make drift an error by default. Every verified concept written before the
  binding existed would fail until a human re-verified the whole bundle.
- Auto-re-verify on edit. Verification records a human confirmation and
  cannot be performed by the editor.

## Consequences

This repository's `.config/okfit.toml` temporarily sets `verified_drift =
"off"`: its existing human verifications predate bindings and are all
`unbound`. It is turned back on once a human has run `okfit verify` over
them. The lint's contract is in [okfit config file
schema](../interfaces/okfit-config-schema.md).
