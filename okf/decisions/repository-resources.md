---
type: Decision
title: Repository resources are classified by where they resolve
description: A cited resource inside the bundle follows OKF v0.3 §6, one inside the project root is a repository resource okfit may stat, list and ask git about, and one outside the project root is never touched and is reported as resource-outside-project.
tags:
  - architecture
sources:
  - resource: ../../packages/engine/src/validate/repository.ts
    title: The candidate list, the real-path containment check and the diagnostic.
  - resource: ../../packages/engine/src/validate/resources.ts
    title: The source-resource-missing lint that reports the outside case.
  - resource: ../../packages/engine/src/validate/untracked.ts
    title: The git-backed lints that judge only a located file.
generated:
  by: okfit/claude-code
  at: 2026-11-24T02:36:26Z
status: draft
integrity:
  generated:
    body: 31426d143208dafc
---

# Repository resources are classified by where they resolve

## Context

A concept's `resource` and `sources[].resource` often name a file in the
repository rather than in the bundle: the software-project profile tells
authors to write `../../packages/core`. OKF v0.3 §6 defines how a path value
resolves inside the bundle and says nothing about a file outside it, so what
okfit may do with such a value is okfit's own rule. Three engine lints read
the disk for these values (`source-resource-missing`, `resource-ignored` and
`resource-untracked`, plus the glob check for a Surface), and none of them
bounded where a value could lead: a `../../..` chain or a symlink could send
`stat`, a directory listing or a `git` call to any path on the machine.

## Decision

Where a value resolves decides what okfit does with it. There are three
places, and the project root (`RunOptions.projectRoot`, the directory that
holds the config, never the bundle root) is the line between the last two.

- **Inside the bundle.** The value follows OKF v0.3 §6: a leading `/` names
  the bundle root; otherwise the file-relative path, then the bundle root for
  a bare value only while `OkfVersion.legacyFallbacks` holds, so the
  version gate of [the declared OKF
  version](declared-okf-version-gates-fallbacks.md) applies to this check as
  it does to links.
- **Inside the project root but outside the bundle.** The value is a
  repository resource. okfit may stat it, list it and ask git whether it is
  tracked or ignored.
- **Outside the project root.** okfit never touches it: no `exists`, `stat`,
  read, listing or git call. It is reported as `resource-outside-project`
  (`info`), ranged at the value. Only the written value, and a link's real path to decide containment, are consulted.

`resourceCandidates` in `validate/repository.ts` computes the absolute
candidates in that order and classifies each as `bundle` or `repository`; a
candidate outside the project root is dropped, so a value with no candidate is
outside the project and the filesystem is not asked about it at all. The
containment test is textual, so a symlink needs one more step: an in-project
path that is a symlink, or lies under a symlinked directory, whose real path
leaves the project root and the bundle root is also `outside`. Resolving a
link's real path is the one permitted disk access that decides containment;
nothing else may reach the target. A path whose real path cannot be resolved
at all, including a dangling link, counts as missing, so it keeps
`source-resource-missing`.

`resource-outside-project` is an `info` lint because a path outside the
project is not an error in the bundle: the author may mean it, and other
checkouts may have it. It is a repository check and not part of OKF. The
three existing codes keep their meaning and severities: a value inside the
project that exists nowhere is still `source-resource-missing`, and
`resource-ignored` and `resource-untracked` (see [A cited file that other
checkouts cannot see is a
lint](untracked-resources.md)) judge only a file that was located inside
the project. The Surface glob check reports the new code for a glob whose
literal prefix is outside the project. Every front end passes the project root
it resolved to the engine (`RunOptions.projectRoot`,
`BundleSessionOptions.projectRoot`); both are required, so a caller cannot
forget it.

## Alternatives rejected

Treating the bundle root as the only boundary would turn every
`../../packages/...` citation in this repository into a violation, when
citing code is the profile's purpose. Checking the project root by text alone
is what the lints did before, and it lets a symlink inside the project lead
anywhere; resolving each candidate's real path costs one call per candidate
and closes it. Making the outside case an error would fail bundles whose
cited files simply live elsewhere, and silence would hide that the check did
not run, so the lint is `info`. Reading the target to see whether it exists,
and then reporting it, would defeat the point of the boundary.

## Consequences

A project that cites a file outside its root sees an `info` line, which never
changes an exit code, and no existence check for that value. A document that
exists only in the editor overlay, in a directory that does not exist on
disk, reads as missing. Resolving the real path of every candidate adds one
filesystem call per literal `resource`, so a large bundle pays a small cost on
each validate.

A candidate inside the bundle that is a symbolic link into the repository is
still found, because its real path is inside the project root. The bundle
loader would not follow that link (OKF 0.3 section 3.2); the two rules differ
because a repository resource is a citation of project files, not bundle
content.
