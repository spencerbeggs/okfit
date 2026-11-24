---
type: Decision
title: The software-project vocabulary grows a fourth time from open migration findings
description: Two types (Flow, Fixture), one tag (config), and a broadened compat tag were added to the software-project profile because migrations kept filing cross-module sequences, external stand-ins, config concerns, and host portability with no home.
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-11-21T01:51:15Z
status: draft
x-okfit-integrity:
  generated:
    body: 281ff74d4aa283a1
---

# The software-project vocabulary grows a fourth time from open migration findings

## Context

[Round three](profiles-vocabulary-round-three.md) left four findings open:
[#116](https://github.com/spencerbeggs/okfit/issues/116) (a runtime
sequence across modules had no type, so each migration split it across
Module bodies), [#133](https://github.com/spencerbeggs/okfit/issues/133)
(a recorded response or sample repository standing in for an external
thing had no type), [#134](https://github.com/spencerbeggs/okfit/issues/134)
(no tag for a project's own user-facing configuration), and
[#220](https://github.com/spencerbeggs/okfit/issues/220) (`compat` named
versions only, with nothing for portability across agent hosts, runtimes,
or operating systems).

## Decision

- **`Flow` type, directory `flows/`.** Optional path-kind fields `entry`,
  `crosses` (Module concepts in the order the sequence reaches them) and
  `resource`; nothing is required. Guidance separates it from Interface
  (a promise to consumers), Runbook (followed by a person) and Module (one
  boundary); failure modes live in the body.
- **`Fixture` type, directory `fixtures/`.** `resource` is required (the
  external thing it stands in for); `runbooks` is an optional path-kind
  list. It takes the default 90-day staleness window through guidance and
  `lifecycle.default_stale_after`, the same mechanism Gotcha uses.
- **`config` tag**: the project's own user-facing configuration, covering
  format, discovery and resolution, schema validation, defaults, and drift
  between config and behavior.
- **`compat` is broadened**, not split: it now also covers portability
  across agent hosts, runtimes, and operating systems.

## Alternatives rejected

- **A separate `portability` tag.** Versions and hosts are both "does it
  work on the other side of this boundary", and two tags would be
  assigned inconsistently.
- **Absorb flows into Module bodies (the workaround).** It splits one
  sequence across files and loses the sequence view.
- **Fold Fixture into DataModel or Reference.** A DataModel is an
  internal source of truth and a Reference mirrors material to cite; a
  Fixture stands in for something external and rots against it.
- **Require `entry` and `crosses` on Flow.** Some flows have no single
  entry file; presence-only checks would force placeholder values.
- **Fold `config` into the `Interface.kind = config` value.** That value
  types a contract; the tag marks any concept concerning configuration.

## Consequences

- `okfit init` now scaffolds nineteen directories. Existing bundles are
  untouched; the new types and tag are available, not required.
- The vocabulary moves together: the profile source, the README TOML
  fence, the `okf-config` skill, the clean fixture bundle, and the
  user-level `okfit-migrate` skill (outside this repository, to be synced
  by hand).
