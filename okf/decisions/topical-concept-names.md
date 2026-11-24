---
type: Decision
title: Concept files are named for their topic; ids stay paths
description: A concept file is named for its stable topic in two to four words and the claim lives in title and description; ids remain bundle-relative paths and okfit mv makes a rename cheap.
tags:
  - docs
  - dx
generated:
  by: okfit/claude-code
  at: 2026-11-24T20:41:11Z
status: stable
x-okfit-integrity:
  generated:
    body: d28db09968ffde15
  verified:
    by: human:spencer
    at: 2026-11-24T22:21:07Z
    content: 56b2dc7b4842650f
verified:
  - by: human:spencer
    at: 2026-10-25T18:29:21Z
  - by: human:spencer
    at: 2026-11-24T22:21:07Z
---

# Concept files are named for their topic; ids stay paths

## Context

Concept file names drift into sentences: `interactive-prompts-gated-by-audience-and-terminal.md` states a conclusion, and the conclusion is the part of a Decision most likely to change. The claim already has a home in `title` and `description`, which are what agents read, so the file name does not need to carry it.

## Decision

Name a concept file for its stable topic in two to four words, and put the claim in `title` and `description`. A concept's id stays its bundle-relative path. A separate `id:` frontmatter key would not spare a rename from rewriting links, because OKF links are paths (§6 of the spec); it would only add a second identity to keep in step with the first. Renames go through `okfit mv`, which rewrites every reference and never writes `verified` or `x-okfit-integrity`, so each rewritten file drifts by the ordinary rule and a human re-verifies it. See [the CLI commands interface](../interfaces/cli-commands.md). The key's prefix is explained in [okfit's keys carry the x-okfit- prefix](okfit-keys-carry-x-okfit-prefix.md).

## Rejected

* An `id:` frontmatter key: a second identity, and links would still be paths.
* Slug aliases or redirect files: they keep the old name alive and leave readers two paths to one concept.
