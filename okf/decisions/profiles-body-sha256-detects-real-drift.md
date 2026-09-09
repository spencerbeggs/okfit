---
type: Decision
title: A body digest inside generated detects real drift, not a rewritten date
description: generated.body_sha256, a lowercase hex sha256 of the P-6-normalized body, lets generated-at-drift compare content instead of dates, so a squash or rebase merge no longer looks like drift.
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-09T22:33:03Z
  body_sha256: c6b04ffef9a182ebed655f904085adca74f1eb3627a1bff82b5686113dc96909
status: stable
verified:
  - by: human:spencer
    at: 2026-09-09T23:08:38Z
---

# A body digest inside generated detects real drift, not a rewritten date

## Context

[Generated.at is the author date of the last commit that changed the
body](profiles-generated-at-is-author-date.md) settled how `generated.at`
is computed, but not how a later reader tells whether that stamp is still
trustworthy. The `generated-at-drift` lint tried to answer that by
re-running the same git-derived computation and comparing dates — and a
squash or rebase merge defeats that comparison completely: both operations
mint a brand-new author date for the commit that lands on the target
branch, so every concept a PR touched looks drifted on `main` the moment
it merges, for a reason no contributor caused. That forced the lint to sit
at `info` and kept `okfit sync --only generated` out of CI (see [okfit
sync is the one command that regenerates every derived-content
family](cli-sync-is-the-derived-content-command.md)'s Consequences
section).

Git alone cannot distinguish the two cases a caller actually cares about:
"a squash rewrote the date but the body is unchanged" from "someone
changed the body and forgot to re-sync." Both look identical from git's
side — a new commit, a new author date, the same or a different blob —
and the stamp itself lives inside the same file as the body it describes,
so any evidence strong enough to tell the two apart has to be
self-corroborating: computed from the body at stamp time and re-checked
against the body as it stands now, never against history.

## Decision

`generated` gains a third, optional key, `body_sha256`: a lowercase
64-character hex sha256 of the concept's body, normalized the same way
`Derivation.body` already normalizes it for every other purpose (CRLF and
lone CR folded to `\n`, trailing whitespace at the end of the text
trimmed) — so a `core.autocrlf` worktree and trailing-newline churn hash
identically, and a frontmatter-only edit never changes the digest.
`Derivation.bodyDigest` computes it through effect's own `Crypto` service,
never `node:crypto` directly, so the dependency reads the same way `Git`,
`GitHistory`, `FileSystem`, and `Path` already do — a declared service
requirement satisfied by `NodeServices.layer`, not a hidden Node import.

The digest is written as a sibling of `at`, inside the spec's `generated`
block, not at a namespaced frontmatter root and not in a sidecar file.
One splice site does both keys: `okfit sync`'s verify/splice machinery
already knows how to locate and rewrite one scalar inside `generated`, so
locating and rewriting two is the same mechanism run twice, merged into a
single edit when they land at the identical insertion offset. A sidecar
file was the alternative most seriously considered, and it fails for one
reason: it conflicts on every parallel branch that touches the same
concept, forcing a merge on a file that carries no other content and no
resolution guidance, exactly the problem `generated.at` living on the
concept itself was already chosen to avoid.

`generated.body_sha256` is okfit's own extension, not an OKF v0.2 field.
The spec defines `generated.by` and `generated.at`; this key exists only
in bundles this repository's tooling has stamped. That is safe by
construction: other OKF tooling ignores frontmatter keys it does not
recognize, and this repo's own core decodes each family independently, so
an unrecognized key inside `generated` costs nothing to a reader that
predates this change (rule 16 of `okf-authoring`: never delete an
unrecognized frontmatter key).

`Provenance.lint`'s `generated-at-drift` becomes two-tier. When
`body_sha256` is present, drift is decided entirely by comparing the
recorded digest to `Derivation.bodyDigest` of the concept's current
source — a pure comparison, no git call, and it fires on a dirty worktree
too, since there is nothing left to derive from history. When
`body_sha256` is absent — an un-migrated concept, or a bundle that has not
run `okfit sync` since this field was introduced — the lint falls back to
the original git-derived date comparison against `Derivation.generatedAt`,
so `--skip-provenance` and every other behaviour this repo already
documented for that path keeps meaning what it meant before. `okfit sync
--only generated` uses the same digest comparison to decide whether to
write anything at all: when the recorded digest still matches the current
body, the concept is reported `unchanged` and `generated.at` is left alone
even though a fresh git walk would compute a different instant — this is
what stops a restamp commit after every squash merge, and is why the new
CI guard (`okfit sync --dry-run --only generated --format json | jq -e
'.generated.written | length == 0'`) can now run without becoming flaky
across a merge.

## Alternatives rejected

Reasoning harder about git history — for instance, trying to detect a
squash by its parent shape and suppress the date comparison just for that
case — was rejected because it multiplies the shapes the lint has to
special-case (squash, rebase, fast-forward, a genuine amend) without ever
closing the gap: some future merge strategy would eventually rewrite dates
in a shape nobody anticipated, and the lint would be wrong again. Content
comparison sidesteps the whole class of problem instead of chasing it.

A namespaced frontmatter root (`okfit: { body_sha256: ... }`, sibling to
`generated`) was rejected because it splits one concern — "is this stamp
still trustworthy" — across two locations in the file, requiring two
splice sites instead of one and giving a reader no reason to associate the
two keys visually.

A sidecar file (one digest manifest at the bundle root, keyed by concept
id) was rejected for the reason under Decision above: it is the one part
of the design that reliably conflicts on every parallel branch, since
every branch that touches any concept touches the same one file.

## Consequences

The `generated-at-drift` lint no longer needs a git call at all for any
concept carrying a digest, which is also why its default moved from
`info` to `warn` — it is cheap enough now to run everywhere, including the
edit-time `PostToolUse` hook path, without the git-walk cost this repo
measured and documented at [The validate hook fires PostToolUse, not
PreToolUse](plugin-posttooluse-not-pretooluse.md).

This amends one line of [okfit sync is the one command that regenerates
every derived-content family](cli-sync-is-the-derived-content-command.md)'s
Consequences without editing that stable Decision: `generated` mode is no
longer "deliberately never guarded in CI" — a squash-merge-proof guard
(`okfit sync --dry-run --only generated --format json | jq -e
'.generated.written | length == 0'`) now runs alongside the `index` guard,
because the digest, not the date, is what that guard now checks. `log`
mode is unaffected and remains unguarded for the reason that Decision
already gives.

An edited-but-uncommitted body now reports drift immediately: the digest
comparison has no "uncommitted" case to fall into the way the git-derived
tier did, so a body changed in the working tree and never synced is
flagged the moment `okfit validate` runs, not skipped until it is
committed. Every concept in this bundle has already been migrated by the
real CLI: each gained a `body_sha256` while its existing, already-correct
`generated.at` was left untouched.
