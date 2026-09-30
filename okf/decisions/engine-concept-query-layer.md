---
type: Decision
title: One engine query layer serves the MCP tools, the CLI and the verify picker
description: "@okfit/engine's ConceptQuery is the single read-only query layer under the MCP concept tools, okfit query, and the future interactive okfit verify picker; there is no okfit status command."
tags:
  - architecture
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-30T17:53:20Z
  body_sha256: 1c2dc9f30be104052c3325f1cca2ef15740bdc6d2f64187d2d4d8d42d77da33b
---

# One engine query layer serves the MCP tools, the CLI and the verify picker

## Context

The MCP tools `list_concepts`, `get_concept` and `concept_neighbors` held
their own filtering and link logic inside `@okfit/mcp`. The CLI needed the
same lookups (`okfit query`), and a planned interactive `okfit verify`
picker on a TTY needs to list attestable concepts. Issue 185 also asked for
a way to see and settle draft concepts.

## Decision

Put the query logic in `@okfit/engine` as `ConceptQuery` (`list`, `get`,
`neighbors`) with its envelopes, and make the MCP tools and `okfit query
list|get|neighbors` thin front ends over it, so selection rules exist once.
The attestation selection rules live beside it as `selectAttestable`.
Promotion from draft belongs with attestation: `okfit verify <id> --stable`
attests and sets status in one write. The status list is `okfit query list
--status`.

## Alternatives rejected

- An `okfit status` command: it would duplicate `query list --status` and
  split promotion from the attestation that justifies it.
- An `okfit query vocabulary` subcommand: `okfit context` already prints the
  declared types and tags.
- Keeping the logic in `@okfit/mcp` and copying it into the CLI: two
  implementations would drift.
- Moving `stale` and `graph` under `query`: they are reports with their own
  envelopes and stay top-level.

## Consequences

The MCP wire contract is unchanged. A change to filtering now lands in one
place and reaches every front end. Fixing a rule in `ConceptQuery` changes
all three callers at once, which is the point and the risk.
