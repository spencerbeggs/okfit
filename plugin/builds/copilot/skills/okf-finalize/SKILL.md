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
2. Reconcile each touched concept against `okf-authoring`'s twenty rules.
3. Run `validate_bundle` — or `okfit validate --format json` when the MCP
   tools are unavailable — and fix what it reports. When the report is
   worth quoting, cite its `engine_version` and `okf_version`; a
   different `okfit_version` between the tool and the CLI is each front
   end's own version, not a different engine.
4. Run `okfit sync` (or `okfit sync --dry-run` first to inspect) to
   regenerate `generated.at`, `integrity.generated.body`, `index.md`, and
   `log.md`. A concept whose recorded digest still matches its body is
   reported `unchanged` and keeps its existing `at`, so a squash-merged
   branch needs no restamp pass. All three are
   derived (`okf-spec`'s reserved-files section plus the
   `generated-at-source` Decision) -- never hand-edit any
   of them. Report what `sync` wrote, left unchanged, or skipped (and why)
   to whoever reads the sweep's output. Agents run non-interactively, so `sync`
   never prompts for them (the human-only `Write N file(s)?` confirm and
   `--yes` do not apply). A concept with uncommitted edits is
   reported skipped (dirty) until it is committed, so tell the human the
   order to follow once they commit: after the commit, run
   `okfit sync --dry-run`, and make a stamp commit only if it reports
   writes. A pre-commit hook with the SAVVY-OKF section runs
   `okfit sync --staged`, which may already have stamped `generated.at` and
   `integrity.generated.body` and the commit's own `log.md` entry into the
   commit, leaving nothing to stamp. When the hook narrowed to
   `--only generated` (unstaged work under the bundle), the follow-up sync
   may still write `index.md` or `log.md`; commit those as the second
   commit. Never create an empty stamp commit.
   To rename a concept file, run `okfit mv <from> <to>` and then `okfit sync`;
   `mv` rewrites every reference, and a sync regenerates `index.md` and the
   stamps. Never rename by hand.
5. Check CLAUDE.md pointer coverage with `okf-context`'s checklist, in both
   directions.
6. Tell the user what changed. Separately, list any concept step 3's
   `okfit validate` reported as `require-verified-unmet` as "awaiting human
   verification" and stop there — this skill never runs `okfit verify`. Tell
   the human that once they have reviewed a draft, `okfit verify <id>
   --stable` settles it in one write: the attestation and the promotion.
   Also list under "awaiting re-verification" every concept
   `okfit query list --drifted` returns (the same set `validate` reports as
   `verified-drift`; `okfit query get <id> --format json` gives each one's
   `drift` reason and who edited it): the branch edited a verified concept, which
   is fine, and only a human re-verifies it (`okfit verify <id>`, which shows
   the diff since the last verification first). Never re-verify it yourself. If
   `validate` reports stale concepts, suggest the human run `okfit stale
   --verify` too (it exits 64 for an agent).

## Ends by reporting, never committing

This skill never commits, never pushes, and never creates a changeset --
that stays a human's call (Spencer's standing rule), restated here because
this is the one skill in the group whose `allowed-tools` includes a
`Bash(...)` grant at all, and therefore the one place the commit boundary
could be crossed by accident. The grants above are scoped to `git diff:*`
and the three `okfit` subcommands this sweep actually runs -- `validate`,
`context` and `query` -- across every invocation form `okfit` is run through in this
repo (direct, `pnpm exec`, `npx`, and `node_modules/.bin/okfit`). There is
no bare `Bash(okfit:*)` grant: `okfit verify` writes a human's attestation
(step 6 above defers to a human for that), and a permission pattern that
cannot match it is a second line of defence alongside the prose, not just
a subcommand list `git commit` happens to be excluded from -- running this
skill to completion means describing what changed and stopping there.
