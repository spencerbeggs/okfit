---
type: Decision
title: Migration to a newer OKF version is a report on validate, with two safe fixes
description: okfit validate --target 0.3 lists what reads differently under that version and --fix writes only two edits (declare okf_version, root a bare path that resolves only from the bundle root); the report never changes the exit code, and a link repair keeps the concept's stamp.
tags:
  - architecture
  - dx
sources:
  - resource: ../../packages/engine/src/migrate/findings.ts
    title: The five finding codes and the rule that finds a root-only reference.
  - resource: ../../packages/engine/src/migrate/fix.ts
    title: The two fixes, the refusals and the body-digest re-record.
  - resource: ../../packages/cli/src/commands/validate.ts
    title: The flags and their usage errors.
  - resource: ../../packages/engine/src/render/exit.ts
    title: The exit-code tally that skips migrate entries.
generated:
  by: okfit/claude-code
  at: 2026-11-24T10:28:07Z
status: draft
integrity:
  generated:
    body: baad688ce1651590
---

# Migration to a newer OKF version is a report on validate, with two safe fixes

## Context

A bundle that declares `okf_version: "0.2"`, or nothing, reads with the v0.2
fallbacks (see [The declared OKF version gates the v0.2
fallbacks](declared-okf-version-gates-fallbacks.md)). Raising the version
changes how a few things read: a bare path that resolved from the bundle
root stops resolving, and the Computation section is found by its first
fence. An author needs to see those before raising it, and a few of them are
a one-character edit that okfit can make safely. Most of what OKF v0.3 added
is not a difference in reading and needs nothing from a bundle.

## Decision

**A report on `validate`, not a converter and not a new command.**
`okfit validate --target 0.3` adds a fourth diagnostic source, `migrate`,
beside `core.conformance`, `core.lint` and `profile`. Reusing `validate`
means the report reuses its loading, scoping by file, human and JSON
rendering and exit codes. A command named `okfit migrate` would also match
the trigger of the user-level `/okfit-migrate` skill, which migrates other
repositories' design docs into okfit and is a different job. `--target`
accepts only `0.3`, the version this okfit implements; any other value is
a usage error, exit `64`. okfit still reads any declared version leniently.

**The findings.** Five codes: `okf-version-undeclared`, `okf-version-older`,
`okf-version-unparsable`, `root-relative-path` and `computation-locator`.
`root-relative-path` is found by resolving each body link, image, definition
and path field under the legacy rule and under the current rule and keeping
the ones that land only through the root fallback; a value that misses under
both is a `broken-links` problem and not a finding. This works on a bundle
that already declares 0.3. `computation-locator` is reported only while the
bundle reads with the legacy locator, because raising the version is what
changes the reading; it is `warning` when the concept would lose its
computation and `info` otherwise. A bundle with no root `index.md` gets
`okf-version-undeclared` with file `index.md` and no fix, since the root
index body is `okfit sync`'s to write.

**What is fixed and what is listed.** `--fix` writes two things: it prefixes
`/` to a root-only reference (the same edit `okfit mv` makes when a bare
reference stops landing), and it declares `okf_version: "0.3"` in the root
index, inserting the key or replacing the old scalar and keeping a BOM and
the file's line endings. Everything else is listed and left to a human or to
the `okf-upgrade` skill: an unparsable version, the computation locator,
`verified-before-change`, `legacy-timestamp`, a typeless `.md`.
`--only okf-version|root-relative-path`, positional targets and `--dry-run`
narrow or preview a run.

**The version fix never makes a bundle worse.** It is refused while any
root-only reference remains after this run, so `--only okf-version` or a
file target cannot flip a bundle to 0.3 with broken links. It is also
refused when `okf_version` cannot be edited in place, and when the root
index's opening fence is not exactly `---`, each with its reason. Refusals
are listed, not errors.

**A link repair keeps the stamp.** OKF v0.3 §5.2 says a link repair does
not change `generated.at`. When a fixed concept's recorded
`integrity.generated.body` matched its body before the edit, the fix
re-records that one digest for the fixed body, so the next `sync` keeps
`generated.at` and every verification that was current stays current. The
fix never writes `generated.at`, `verified` or `integrity.verified`. A
concept whose human verification covered content the fix changes (a path
field is authored frontmatter) is listed as an integrity drift for the
human to re-verify. `okfit mv` does not yet follow this rule: it writes
only the changed text, so the next `sync` restamps the concept.

**The report is not a gate.** A `migrate` entry never changes the exit code;
the JSON summary carries `migration_findings` and the envelope carries
`target`, and `fixes` after `--fix`. A CI job that wants a gate reads the
summary. The human report puts the count on its own line.

## Alternatives rejected

A general converter would write files for cases that need a human's
judgement and would put okfit's name on edits nobody reviewed; only the two
mechanical edits are written. A separate `okfit migrate` command would
duplicate the loading and rendering `validate` already owns and collide with
the user-level skill's trigger. Exiting `1` while findings remain would fail
any CI run of a bundle that has not moved yet, this repository's own bundle
included, when the report is advice about a decision. Fixing only path
fields would leave every bare body link broken the moment the version is
raised, and the refusal rule would then block the version fix for good.
Writing the digest like `okfit mv` does would lower the trust tier of every
fixed concept for a one-character change.

## Consequences

Migrating a bundle is: run the report, `--fix` the two safe kinds, work
through what is listed, then re-verify the concepts reported as drifted,
which is a human act. okfit writes one integrity digest outside `sync`, a
derived value and never an attestation. The editor does not run `--target`,
and there is no language server action or MCP input for it yet. `okfit mv`
should follow the link-repair rule; until then a move restamps.
