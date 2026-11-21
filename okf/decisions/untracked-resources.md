---
type: Decision
title: A cited file that other checkouts cannot see is a lint, split by whether it is ignored
description: validate flags a resource or sources[].resource that exists locally but is gitignored (resource-ignored, error) or not yet tracked (resource-untracked, warn), as an engine lint that --skip-provenance and the language server skip.
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-11-21T01:47:57Z
status: draft
sources:
  - resource: https://github.com/spencerbeggs/okfit/issues/279
    title: "validate: error on references to untracked or gitignored files"
integrity:
  generated:
    body: 4b6e6e2bd852f6b4
---

# A cited file that other checkouts cannot see is a lint, split by whether it is ignored

## Context

A concept can cite a file that exists in the author's checkout but is
gitignored or not committed. `okfit validate` passes locally, while CI, a
teammate and every consumer of the bundle see the file as missing. This
happened when three Decisions cited a gitignored design spec as a
`sources[].resource`: validate was clean locally and the dogfood end-to-end
suite, which pins zero warnings, failed only in CI.

## Decision

Two engine lints run beside `source-resource-missing`, over the same literal
`resource` and `sources[].resource` values and nothing wider:

- `resource-ignored` (default `error`) flags a path that exists but is
  gitignored. Nothing can ever make that citation resolve elsewhere.
- `resource-untracked` (default `warn`) flags a path that exists but git does
  not track yet. It is not raised once the file is staged, because a new concept
  and its new source are normally committed together.

Globs, URLs and scope descriptors are skipped, a missing file keeps
`source-resource-missing`, and a bundle outside a git repository skips both. A
directory is tracked when the index lists at least one file under it. A path
inside a submodule is judged against the submodule's own index, and the
submodule path itself counts as tracked. The lint is git-backed, so
`--skip-provenance` (the PostToolUse hook path) skips it and so does the
language server's session; CLI `validate` and the MCP `validate_bundle` run it.
The git work is batched: one `ls-files` and at most one `check-ignore` per
repository.

## Alternatives rejected

A single `resource-untracked` code at `error` would fail a legitimate first
commit in which a concept and its source file are added together. A single code
at `warn` would let the real failure, a citation that can never resolve in CI,
pass. Splitting the code lets each case carry its own severity.

Running the lint in the language server and the edit-time hook would add a git
spawn to every keystroke-scale revalidation for a signal that only matters at
commit and CI time.

Widening the scope to `kind: path` frontmatter fields and relative body links
was deferred rather than rejected; the `source-resource-missing` walk is the
set every other resource lint already shares.

## Consequences

An author who cites a gitignored plan or spec as a source now gets an error
and must restate the reasoning in the concept. The `okf-authoring` skill says
so.
