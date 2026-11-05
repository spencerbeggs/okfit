---
type: Decision
title: Heading anchors match github-slugger, through the kit's slugger
description: The broken-links fragment check resolves against @effected/markdown's headingSlugs, which ports github-slugger, rather than okfit's own slug rule, accepting that links written to the old rule start warning.
tags:
  - dx
  - compat
status: draft
sources:
  - id: okfit-361
    resource: https://github.com/spencerbeggs/okfit/issues/361
  - id: owner-ruling
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-05T00:00:00Z
  - id: lint-rules
    resource: ../../packages/core/src/internal/lintRules.ts
generated:
  by: okfit/claude-code
  at: 2026-11-05T22:55:24Z
integrity:
  generated:
    body: 17d50c93ca38cebd
---

# Heading anchors match github-slugger, through the kit's slugger

## Context

`broken-links` checks a `#fragment` against the target concept's heading
slugs. okfit computed those with its own rule, described as GitHub-style, that
collapsed runs of spaces, trimmed, and dropped underscores and combining marks.
So `## A — B` slugged to `#a-b` where GitHub-style tools give `#a--b`, a link
could pass the lint and fail on GitHub or the reverse, and two headings in one
concept could share a slug[^okfit-361].

## Decision

Resolve fragments against `MarkdownDocument.headingSlugs` from
`@effected/markdown`[^lint-rules], so a concept's anchors follow `github-slugger`:
lowercase, drop what it drops, turn each space into one hyphen with no trimming
or collapsing, and suffix repeats so every slug is unique. The repository owner
chose this over keeping the old rule[^owner-ruling].

Parity is with `github-slugger`, not with GitHub itself, whose algorithm is not
public.

## Alternatives rejected

Keeping okfit's rule and fixing only the duplicate case: rejected because it
keeps anchors that differ from what authors see on GitHub, which is the mistake
authors kept making by guessing `#a--b`.

Accepting both forms for a transition: rejected because a link that passes under
either rule says nothing about whether it works where it is read.

## Consequences

A link written to the old form now reports `broken-links` with a `did you mean`
hint naming the new slug. Measured on 2026-11-05 across this bundle and 18 others
in local checkouts, 17 of 231 inline fragment links change this way, 16 in
effected and 1 in vitest-agent; this bundle has none.

[^okfit-361]: <https://github.com/spencerbeggs/okfit/issues/361>
[^owner-ruling]: conversation with the repository owner
[^lint-rules]: `packages/core/src/internal/lintRules.ts`
