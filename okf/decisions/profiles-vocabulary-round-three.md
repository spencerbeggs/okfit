---
type: Decision
title: The software-project vocabulary grows a third time from the silk action migrations
description: Two types (Invariant, Incident), a worker Module kind, and two tags (github, docs) were added to the software-project profile, and Gotcha and Roadmap guidance now settle the known-bug and no-in-repo-resource cases, because four GitHub Action migrations filed the same gaps.
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
status: draft
---

# The software-project vocabulary grows a third time from the silk action migrations

## Context

[The second growth round](profiles-vocabulary-round-two.md) took the
profile to fourteen types and eleven tags. Four more migrations then ran
on the same day -- savvy-web/silk-release-action (55 concepts),
silk-update-action, silk-runtime-action, and
spencerbeggs/claude-code-marketplace-manager -- and filed
[#99](https://github.com/spencerbeggs/okfit/issues/99) through
[#112](https://github.com/spencerbeggs/okfit/issues/112) with the same
shape of finding as before: a property the type system or a pinned test
holds by construction had no home except Convention, whose imperative
voice reads badly for a rule nobody follows; a dated postmortem had to be
split across a Gotcha (the signal) and a Decision (the guard), losing the
narrative; a sidecar bundle an action spawns was filed as `kind: action`
for want of a value; a third of one repository's concepts concerned the
GitHub platform surface and another third of a design doc concerned the
documentation's own rot, with no tag for either; and two guidance gaps
(a Gotcha whose signal comes from outside the repository, and a known bug
sitting between Gotcha and Roadmap) were decided independently per
batch.

## Decision

- **Two new types**, each with a layout directory: `Invariant` (an
  optional path-kind `resource` naming the type, function, or test that
  enforces it) and `Incident` (`occurred` required as free text, since
  core has no date field kind; an optional path-kind `guard`).
- **`worker` joins `Module.kind`**: a detached sidecar or worker bundle
  another module spawns, with its own lifecycle, that is not itself a
  package or action.
- **Two new tags**: `github` and `docs`.
- **Framework tags stay repo-local.** An `effect` tag
  ([#100](https://github.com/spencerbeggs/okfit/issues/100)) names one
  framework, which is a fact about a repository and not about the
  software-project shape; the `okf-config` skill now says how to declare
  one and when a migration should.
- **Gotcha and Roadmap guidance settle two recurring calls.** A Gotcha
  whose misleading signal is produced outside the repository omits
  `resource` and names the outside system in the body; a known bug nobody
  is scheduled to fix is a Gotcha with a `stale_after` and becomes a
  Roadmap once the fix is planned.

## Alternatives rejected

- **Fold Invariant into Convention.** The complaint was exactly that
  Convention's guidance ("state the rule as an instruction") misfits a
  property people cannot choose to ignore.
- **Fold Incident into Gotcha plus Decision.** That split is what every
  migration did by hand and each reported the narrative lost.
- **A `framework:<name>` tag convention.** A colon in a tag is legal but
  reads as a namespace the profile does not define; a plain `effect` tag
  declared locally says the same thing with no new rule.
- **A `subsystem` kind instead of `worker`.** Broader than the evidence:
  every report was a spawned runtime unit with its own lifecycle.

## Consequences

- `okfit init` now scaffolds fifteen directories. Existing bundles are
  untouched; the new types, kind, and tags are available, not required.
- `Incident.occurred` is free text until core grows a date field kind; a
  non-date value passes validation.
- The vocabulary moves together in the same places as before: the
  profile source, `packages/profiles/README.md`'s TOML fence, the
  `okf-config` skill, the clean fixture bundle, and the `okfit-migrate`
  mapping table (a user-level skill outside this repository).
