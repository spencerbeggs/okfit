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
  at: 2026-11-24T10:37:49Z
status: stable
x-okfit-integrity:
  generated:
    body: f1d50aed2c0afdd4
  verified:
    by: human:spencer
    at: 2026-11-24T14:56:24Z
    content: 4d6ee394b08a9bf4
verified:
  - by: human:spencer
    at: 2026-11-23T22:18:48Z
  - by: human:spencer
    at: 2026-11-24T02:55:14Z
  - by: human:spencer
    at: 2026-11-24T14:56:24Z
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
block that is not a mapping is a conformance error, now reported as
`frontmatter-unparseable` (before this work it was `type-missing`), and
`frontmatter-unclosed` is unchanged. An empty frontmatter block has no
`type`, so it is `type-missing` (a warning), not a conformance error
(OKF v0.3 §3.2 rule 2). Both
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

Whether a typeless file belongs in a bundle at all is okfit's opinion, not
conformance, because §3.2 allows such files. Two pieces carry it, and core
stays free of any default:

- `[bundle] non_concepts` is a list of globs, relative to the bundle root,
  of the `.md` files allowed to have no frontmatter or no `type`. It has no
  core default. A glob that does not compile fails config decode. The
  software-project profile sets it to `**/README.md`, `**/AGENTS.md`,
  `**/CONTRIBUTING.md` and `**/SKILL.md`, the four names §3.2 lists.
- The lint `non-concept-unlisted` (key `non_concept_unlisted`, default
  `warn`) reports a file that `Bundle.load` skipped as `frontmatter-missing`
  or `type-missing` and that no glob matches. It is silent when the key is
  absent, so a bundle on no profile and no key has no guard. A listed file
  still draws `type-missing` or `frontmatter-missing`, as §3.2 asks of a
  validator; an author who wants silence sets those two lints to `off`.

The plugin's PostToolUse hook has a third job on top of the two in
[its scope Decision](posttooluse-hook-scope.md): it reads that lint. A
`Write`, or a Bash authoring write (`>`, `tee`, `cp`), that produces an
unlisted non-concept `.md` blocks, and an `Edit` of one warns. The hook
still fires after the file exists, so it is stop-and-fix, not prevention.
The `okf-authoring`
skill carries the same rule as rule 22.

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
strictness raises `type_missing` to `error` in `[lint]`. On the
software-project profile the guard catches the common case, an agent writing
a typeless file that is not one of the four listed names; a bundle that sets
`non_concepts = []` allows none, and the lint is silent only when the merged
config has no key, which is `profile = "none"` with no `non_concepts` of its
own; the software-project profile, the default, always supplies the four
globs.
`non_concept_unlisted` is a public config key, so the lint keys number forty.

`sync` never stamps or rewrites a concept file that is a link out of the
bundle, because `Bundle.load` drops it, and an engine test pins that. The
reserved files differ in what core does with them. A root `index.md` that is
a symlink out of the bundle is not loaded, so its metadata and declared
version are not read and the bundle reads as legacy. `sync` does not write
through such a link either: a root or subdirectory `index.md`, or the root
`log.md`, that is a symlink out of the bundle (a dangling link included) is
skipped with the reason `symlink-escape`, never read and never written, in
plain, dry-run and `--staged` runs, and the exit code is unchanged. The check
asks core's load diagnostics first and falls back to `lstat` plus
`confineReal`, because the walker does not list a dangling link and so leaves
no diagnostic.
