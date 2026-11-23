---
type: Decision
title: A concept outside the repository is a typed failure
description: Derivation.generatedAt fails with ConceptOutsideRepositoryError when a concept file resolves outside the repository, rather than reporting a provenance reason or a git error.
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-11-23T21:20:06Z
status: draft
integrity:
  generated:
    body: 0cfa3c3c549fb10e
---

# A concept outside the repository is a typed failure

## Context

`Derivation.generatedAt` needs the concept's repository-relative path to ask
git about it. When the file resolves outside the repository through an
escaping symlink, or containment cannot be proved (a loop, `EACCES`), there
is no such path, and the old hand-rolled `path.relative` produced a `../`
spelling that surfaced downstream as an opaque `GitCommandError` (#351).

## Decision

The path comes from `relativeWithin(realRoot, file, { missing: "refuse" })`
in `@effected/walker`. On `None`, `Derivation.generatedAt` fails with
`ConceptOutsideRepositoryError({ file, root })`, a member of
`GeneratedAtError`, naming the file. The file is read before containment is
checked, so a missing file or dangling link still fails with a
`PlatformError` `NotFound`. `okfit sync --staged` uses the same helper and
error for its two hand-rolled copies in `packages/engine/src/sync/run.ts`.
`BodyProvenance` is unchanged. Validate and the session revalidate carry
the error through their failure unions.

## Alternatives rejected

A new `uncommitted` reason `outside` would widen `BodyProvenance` for every
consumer to describe a file that is not a repository member at all, and a
body "with no commit yet" is a different fact from "cannot be dated". Reusing
`uncommitted` `untracked` would tell callers the file is merely new, hiding a
containment fault they should fix.

## Consequences

When this Decision was made, a symlinked-out concept stopped `sync`,
`validate` and the LSP revalidate with a message naming the file, where
`--staged` previously skipped such a concept silently. In-repo symlinks date
identically to their target.

OKF v0.3 §3.2 changed the first half. A concept file that is a symbolic link
out of the bundle root is now never loaded: `Bundle.load` reports the lint
`symlink-escape` (`warn`) and drops the file, so it never reaches
`Derivation.generatedAt` or `sync`, and that route no longer produces
`ConceptOutsideRepositoryError`. `sync` neither stamps nor rewrites such a
file, which an engine test pins.

`ConceptOutsideRepositoryError` still occurs in `sync --staged` when
`log.md` resolves outside the repository: the `log.md` check in
`packages/engine/src/sync/run.ts` still fails with it, and an engine test
(`__test__/sync/run.test.ts`) pins that case. The concept-path guard in the
same function (the check made for each loaded concept) is kept, but whether
any path through symlinks can still reach it is unverified: the walker does
not descend a symlinked directory and `Bundle.load` drops an escaping file
link, which suggests it is unreachable that way, but no test shows it either
way. A bundle root that is itself a symlink resolving outside the repository
is the candidate case, and it has not been tested.
