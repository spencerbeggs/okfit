---
type: Decision
title: stale --verify rolls stale_after forward, and plain verify never does
description: okfit stale --verify re-attests the chosen stale concepts and moves their stale_after to the attestation instant plus lifecycle.default_stale_after in one all-or-nothing write; verify itself leaves stale_after alone.
tags:
  - architecture
  - dx
status: stable
generated:
  by: okfit/claude-code
  at: 2026-11-25T15:08:01Z
x-okfit-integrity:
  generated:
    body: 396488d1f7cfe25d
  verified:
    by: human:spencer
    at: 2026-11-26T03:32:38Z
    content: 50a785657d2e0e32
verified:
  - by: human:spencer
    at: 2026-10-25T18:29:21Z
  - by: human:spencer
    at: 2026-11-24T02:55:14Z
  - by: human:spencer
    at: 2026-11-24T06:53:02Z
  - by: human:spencer
    at: 2026-11-24T22:21:07Z
  - by: human:spencer
    at: 2026-11-25T13:30:00Z
  - by: human:spencer
    at: 2026-11-26T03:32:38Z
---

# stale --verify rolls stale_after forward, and plain verify never does

## Context

`okfit stale` lists concepts whose `stale_after` instant has passed, but
only reports. Re-reviewing one meant running `okfit verify`, which appends an
attestation and leaves `stale_after` untouched, so the concept stayed in the
stale list and the lint rule kept firing until someone also edited the date by
hand. Issue #228 asked for a re-verify path from the stale report itself.

## Decision

- `okfit stale --verify [--dry-run]` is the only command that rolls
  `stale_after` forward. On a terminal it prints the report, opens the
  `Re-verify which stale concepts?` picker and the confirm with the promote
  toggle, then writes through the engine's `runVerifyIds` with
  `refreshStaleAfter: true`.
- Each picked concept is attested and its `stale_after` is set to the
  attestation instant plus `lifecycle.default_stale_after`, in the same
  all-or-nothing write as the attestation: a shape that cannot be spliced
  safely fails the whole batch with nothing written.
- A re-attest by the same actor overwrites that actor's own `verified[].at`
  instead of appending a second entry, so repeated stale cycles do not grow
  the list. Section 5.3 says earlier events stay in the file as history, and
  an overwrite replaces that actor's earlier `at`; this is okfit's named
  variation from the spec, kept so repeated stale cycles stay bounded. The
  same edit rewrites `x-okfit-integrity.verified` so its `at` and
  content digest agree with the refreshed entry (see [integrity
  frontmatter](../interfaces/integrity-frontmatter.md)). The key's prefix is explained in
[okfit's keys carry the x-okfit- prefix](okfit-keys-carry-x-okfit-prefix.md).
- Candidates include a drifted concept even when this actor already has an
  entry, because "already verified" now means holding the current binding,
  and a binding is current only while its bound entry is a current event
  under OKF v0.3 section 5.3 (not before `generated.at`). The stale picker's
  candidates, however, are chosen by staleness alone
  (`selectStaleCandidates` never consults integrity); the picker then leaves out
  a concept whose `generated.at` is later than the attestation instant and says
  which one it left out and what to do about it, one line per concept (#470, #504).
- A concept whose `generated.at` is later than the attestation instant is
  skipped as `not-current` and the rest are attested, so one such concept does
  not fail the batch; if every picked concept is skipped nothing is written
  (#470). Only a single `okfit verify <id>` still refuses it, as
  `VerifyNotCurrentError` (exit `3`).
- A concept whose `stale_after` cannot be read is never stale, so it is
  never a candidate. `okfit stale` lists it apart, under `malformed
  stale_after`, with the value as written, and the JSON envelope carries it in
  a separate `malformed` list; `days_past` stays a number and `items` keep
  their shape. Rolling a date forward over a value nobody can read would
  replace it without anyone seeing what it said, so the author fixes it by
  hand.
- Plain `okfit verify` keeps its contract: it appends, and never touches
  `stale_after`.
- The command is interactive-only. A non-interactive run is exit `64`,
  `--dry-run` without `--verify` is exit `64`, and cancelling exits `130`
  with nothing written, as for every prompt under [Interactive prompts are
  gated by audience and
  terminal](interactive-prompt-gates.md).

## Alternatives rejected

- Attest only: re-verifying from the stale report would leave the concept
  stale, because the date that makes it stale is unchanged. The command would
  succeed and change nothing the report reads.
- Roll `stale_after` forward in every `okfit verify`: a broader behaviour
  change that would silently edit a field every existing verify caller
  assumes is untouched, including the batch, `--stable` and picker forms, and
  concepts that were never stale.

## Consequences

The contract is in [CLI commands](../interfaces/cli-commands.md); the engine
option and candidate selection are in [Engine](../modules/engine.md), and the
picker wiring in [CLI](../modules/cli.md). The attestation itself stays a
human act: no agent, hook or MCP tool runs this command, and a human must
verify this Decision before it counts as settled.
