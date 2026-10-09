---
name: okf-finalize
description: "Branch-end sweep: reconcile every concept the branch's diff touches, run okfit validate and fix what it reports, check CLAUDE.md pointer coverage, and report what changed. Use at the end of a branch of work that touched the okf/ bundle or its context files, before handing off to a human for commit and changeset. Trigger phrases -- \"finalize the bundle\", \"wrap up the okf changes\", \"reconcile the docs before merging\", \"sweep the bundle\"."
allowed-tools:
  - read
  - grep
  - glob
  - edit
  - execute
---

# okf-finalize

## The sweep, in order

Run all six steps sequentially in one context. There is no `context: fork`
here (M-12) -- design-docs' finalize workflow isolates its bundle-editing,
context-editing, and readme-editing phases across three separate agents
(`FIELDSTUDY:448-457`), and this plugin consciously trades that isolation
for the simplicity of one agent running one skill straight through.

1. List the concepts the branch's diff touches: `git diff` against the base
   branch, restricted to bundle paths.
2. Reconcile each touched concept against `okf-authoring`'s nineteen rules.
3. Run `validate_bundle` — or `okfit validate --format json` when the MCP
   tools are unavailable — and fix what it reports. When the report is
   worth quoting, cite its `engine_version` and `okf_version`; a
   different `okfit_version` between the tool and the CLI is each front
   end's own version, not a different engine.
4. Run `okfit sync` (or `okfit sync --dry-run` first to inspect) to
   regenerate `generated.at`, `generated.body_sha256`, `index.md`, and
   `log.md`. A concept whose recorded digest still matches its body is
   reported `unchanged` and keeps its existing `at`, so a squash-merged
   branch needs no restamp pass. All three are
   derived (`okf-spec`'s reserved-files section plus the
   `profiles-generated-at-is-author-date` Decision) -- never hand-edit any
   of them. Report what `sync` wrote, left unchanged, or skipped (and why)
   to whoever reads the sweep's output. Agents run non-interactively, so `sync`
   never prompts for them (the human-only `Write N file(s)?` confirm and
   `--yes` do not apply). A concept with uncommitted edits is
   reported skipped (dirty) until it is committed, so tell the human the
   order to follow once they commit: after the commit, run
   `okfit sync --dry-run`, and make a stamp commit only if it reports
   writes. A pre-commit hook with the SAVVY-OKF section runs
   `okfit sync --staged`, which may already have stamped `generated.at` and
   `generated.body_sha256` into the commit, leaving nothing to stamp. That
   hook path never writes `log.md`, so the follow-up sync may write only
   `log.md`; commit that alone as the second commit. Never create an empty
   stamp commit.
5. Check CLAUDE.md pointer coverage with `okf-context`'s checklist, in both
   directions.
6. Tell the user what changed. Separately, list any concept step 3's
   `okfit validate` reported as `require-verified-unmet` as "awaiting human
   verification" and stop there — this skill never runs `okfit verify`. Tell
   the human that once they have reviewed a draft, `okfit verify <id>
   --stable` settles it in one write: the attestation and the promotion. If
   `validate` reports stale concepts, suggest the human run `okfit stale
   --verify` too (it exits 64 for an agent).

## Ends by reporting, never committing

This skill never commits, never pushes, and never creates a changeset --
that stays a human's call (Spencer's standing rule), restated here because
this is the one skill in the group whose `allowed-tools` includes a
`Bash(...)` grant at all, and therefore the one place the commit boundary
could be crossed by accident. The grants above are scoped to `git diff:*`
and the two `okfit` subcommands this sweep actually runs -- `validate` and
`context` -- across every invocation form `okfit` is run through in this
repo (direct, `pnpm exec`, `npx`, and `node_modules/.bin/okfit`). There is
no bare `Bash(okfit:*)` grant: `okfit verify` writes a human's attestation
(step 6 above defers to a human for that), and a permission pattern that
cannot match it is a second line of defence alongside the prose, not just
a subcommand list `git commit` happens to be excluded from -- running this
skill to completion means describing what changed and stopping there.
