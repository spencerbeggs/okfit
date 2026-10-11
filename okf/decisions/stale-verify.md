---
type: Decision
title: stale --verify rolls stale_after forward, and plain verify never does
description: okfit stale --verify re-attests the chosen stale concepts and moves their stale_after to the attestation instant plus lifecycle.default_stale_after in one all-or-nothing write; verify itself leaves stale_after alone.
tags:
  - architecture
  - dx
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-11T20:51:30Z
integrity:
  generated:
    body: 8f57f88dd1c91f3c
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
  the list. The same edit rewrites `integrity.verified` so its `at` and
  content digest agree with the refreshed entry (see [integrity
  frontmatter](../interfaces/integrity-frontmatter.md)).
- Candidates include a drifted concept even when this actor already has an
  entry, because "already verified" now means holding the current binding.
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
