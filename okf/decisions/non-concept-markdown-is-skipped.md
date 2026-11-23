---
type: Decision
title: Markdown that is not a concept is skipped, not an error
description: A .md file with no frontmatter, or frontmatter with no type, is not a concept under OKF v0.3 §3.2; core skips it with a warning, and a symlink that leaves the bundle is never loaded.
tags:
  - architecture
sources:
  - resource: ../../packages/core/src/Bundle.ts
    title: The load that skips the file and the symlink check.
  - resource: ../../packages/core/src/internal/frontmatter.ts
    title: The type-missing lint and the not-a-mapping conformance error.
  - resource: ../../plugin/__test__/post-tool-use-validate.bats
    title: The test that pins the quieter hook.
generated:
  by: okfit/claude-code
  at: 2026-11-23T21:20:06Z
status: draft
integrity:
  generated:
    body: bdce512b5320f487
---

# Markdown that is not a concept is skipped, not an error

## Context

OKF v0.2 treated every `.md` file in the bundle as a concept, so a README
with no frontmatter was a conformance error and exit code 2. OKF v0.3 §3.2
says a markdown file with no frontmatter, or with frontmatter that has no
`type`, is not a concept, and a consumer ignores it. §3.2 also says a file
must not be read when it resolves outside the bundle.

## Decision

Core follows §3.2. `frontmatter-missing` (no frontmatter fence) and
`type-missing` (no non-empty string `type`) are lint codes with default
severity `warn`, no longer conformance errors. The file is skipped: it is
not in `concepts`, not in the graph and not in any index. A frontmatter
block that is not a mapping stays a conformance error under the existing
`frontmatter-unparseable`, and `frontmatter-unclosed` is unchanged. Both
new codes are overridable in `[lint]` like any other lint.

A file in the bundle that is a symbolic link whose target resolves outside
the bundle root, or cannot be resolved at all, is never read. `Bundle.load`
checks each walked file with `lstat`, and for a link asks `confineReal`
(`@effected/walker`) whether it stays inside. A refusal produces the lint
`symlink-escape` (`warn`) and the file is dropped from the bundle's file
list. A link that stays inside the bundle loads as before.

The consequence for exit codes is accepted: a bundle that holds a README or
any other typeless markdown file now validates with exit code 0 and a
warning, where it exited 2 before.

The plugin's PostToolUse hook blocks only on `core.conformance` findings.
Because the two codes left that tier, a Write of a typeless or
frontmatter-less `.md` into a bundle no longer blocks the agent; a bats
test pins this. Whether okfit should still stop an agent from writing such a
file into a bundle is an open question for the owner, not a decision: it
would be an okfit opinion on top of the spec, to be carried by the profile
or the hook, not by core.

## Alternatives rejected

Keeping `type-missing` a conformance error would make okfit reject bundles
that §3.2 says are valid, and would force every repository that keeps
README files in its bundle to move them. Silently skipping, with no
diagnostic, would hide the common mistake of forgetting a `type`; the
warning keeps that visible. Following a link out of the bundle and reading
it would let a bundle read arbitrary files and stamp them; refusing it
matches §3.2.

## Consequences

A concept that loses its `type` in an edit now disappears from the graph with
a warning instead of failing validation, so a team that wants the old
strictness raises `type_missing` to `error` in `[lint]`. The hook is quieter
than before until the open question is settled. `sync` never stamps or
rewrites a file that is a link out of the bundle; an engine test pins that.
