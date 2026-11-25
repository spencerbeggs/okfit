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
  at: 2026-11-25T01:55:51Z
status: draft
x-okfit-integrity:
  generated:
    body: 7cd90f1491bb237a
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
changes the reading, and only when the two readings differ (a depth-one
section that is exactly one fence reads the same and is not reported); it is `warning` when the concept would lose its
computation and `info` otherwise. A bundle with no root `index.md` gets
`okf-version-undeclared` with file `index.md` and no fix, since the root
index body is `okfit sync`'s to write.

**What is fixed and what is listed.** `--fix` writes two things: it prefixes
`/` to a root-only reference (the same edit `okfit mv` makes when a bare
reference stops landing), and it declares `okf_version: "0.3"` in the root
index, inserting the key or replacing the old scalar and keeping a BOM and
the file's line endings. The report and the fixes cover every Markdown file in
the bundle that is not a concept (index files, `log.md`, typeless and
frontmatter-less files), so a root-only link in an index file or `log.md` is
rooted like any other; only the version fix itself (the root index's `okf_version`)
can be held back. Three `migrate` findings are listed with no fix and left to a human or to
the `okf-upgrade` skill: an unparsable version, the computation locator, and
an undeclared version when there is no root index. The existing core lints
that bear on a migration (`verified-before-change`, `legacy-timestamp`,
`frontmatter-missing` and `type-missing`) are not `migrate` findings; they
report the same with or without `--target`.
`--only okf-version|root-relative-path`, positional targets and `--dry-run`
narrow or preview a run.

**The version fix never makes a bundle worse.** It is refused while any
root-only reference remains after this run, so `--only okf-version` or a
file target cannot flip a bundle to 0.3 with broken links. It is also
refused while an Attested Computation would lose its computation, while a
Markdown file could not be read to check its links, when `okf_version` cannot be edited in place, and when the root
index's opening fence is not exactly `---`, and when the root index frontmatter
does not parse (malformed YAML, a duplicate key), each with its reason; the rest
of the plan still applies. Refusals are listed, not errors. One cost is known:
a `warning` `computation-locator` finding (a computation that 0.3 would not
find) stops being reported once the bundle declares 0.3, so the version fix
is refused while one exists, and `okf-upgrade` reports it to the human. The
`computation-missing` lint reports an Attested Computation with no
computation, so a lost one shows up after the version moves.

**A link repair keeps the stamp.** OKF v0.3 §5.2 says a link repair does
not change `generated.at`. When a fixed concept's recorded
`x-okfit-integrity.generated.body` matched its body before the edit, the fix
re-records that one digest for the fixed body, so the next `sync` keeps
`generated.at`; the trust tier, which counts only verification events at or
after `generated.at` (§5.3), is therefore not lowered by the edit. The fix
never writes `generated.at`, `verified` or `x-okfit-integrity.verified`. The key's prefix is explained in
[okfit's keys carry the x-okfit- prefix](okfit-keys-carry-x-okfit-prefix.md). okfit's own
verification integrity is a separate signal and can still drift, because its
content digest covers the body and the authored frontmatter, so any edit
moves it. `drifts` lists every edited concept whose integrity was current
before the edit (a body-link edit counts as well as a path-field edit), plus
any edited concept whose `x-okfit-integrity` block has a layout the fix will not
edit, so its body digest could not be re-recorded. The human re-verifies
those; the CLI prints `Integrity drifted (re-verify with okfit verify):
<ids>`. `okfit mv` does not yet follow this rule: it writes
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
Writing only the changed text, as `okfit mv` does, would let the next `sync`
restamp `generated.at` and so lower the trust tier of every fixed concept for
a one-character change.

## Consequences

Migrating a bundle is: run the report, `--fix` the two safe kinds, work
through what is listed, then re-verify the concepts reported as drifted,
which is a human act. okfit writes one digest outside `sync`, the generated
body digest (`x-okfit-integrity.generated.body`), a derived value and never an
attestation. The editor does not run `--target`, and there is no language
server action or MCP input for it yet. `okfit mv` does not follow the
link-repair rule today, so a move restamps; aligning it is an open follow-up.
