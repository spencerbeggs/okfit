---
type: Decision
title: Concept files are named for their topic; ids stay paths
description: A concept file is named for its stable topic in two to four words and the claim lives in title and description; ids remain bundle-relative paths and okfit mv makes a rename cheap.
tags:
  - docs
  - dx
generated:
  by: okfit/claude-code
  at: 2026-10-11T20:18:01Z
status: draft
integrity:
  generated:
    body: d590024d84d9aa41
---

# Concept files are named for their topic; ids stay paths

## Context

Concept file names drift into sentences: `interactive-prompts-gated-by-audience-and-terminal.md` states a conclusion, and the conclusion is the part of a Decision most likely to change. The claim already has a home in `title` and `description`, which are what agents read, so the file name does not need to carry it.

## Decision

Name a concept file for its stable topic in two to four words, and put the claim in `title` and `description`. A concept's id stays its bundle-relative path. A separate `id:` frontmatter key would not spare a rename from rewriting links, because OKF links are paths (§6 of the spec); it would only add a second identity to keep in step with the first. Renames go through `okfit mv`, which rewrites every reference and never writes `verified` or `integrity`, so each rewritten file drifts by the ordinary rule and a human re-verifies it. See [the CLI commands interface](../interfaces/cli-commands.md).

## Rejected

* An `id:` frontmatter key: a second identity, and links would still be paths.
* Slug aliases or redirect files: they keep the old name alive and leave readers two paths to one concept.
