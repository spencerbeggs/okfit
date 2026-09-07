---
name: okf-finalize
description: >-
  Branch-end sweep: reconcile every concept the branch's diff touches, run
  okfit validate and fix what it reports, check CLAUDE.md pointer coverage,
  and report what changed. Use at the end of a branch of work that touched
  the okf/ bundle or its context files, before handing off to a human for
  commit and changeset. Trigger phrases -- "finalize the bundle", "wrap up
  the okf changes", "reconcile the docs before merging", "sweep the bundle".
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git diff:*), Bash(okfit:*), Bash(pnpm exec okfit:*), Bash(npx okfit:*), Bash(node_modules/.bin/okfit:*)
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
2. Reconcile each touched concept against `okf-authoring`'s sixteen rules.
3. Run `validate_bundle` — or `okfit validate --format json` when the MCP
   tools are unavailable — and fix what it reports.
4. Regenerate `index.md` and `log.md`. Both are derived files (`okf-spec`'s
   reserved-files section) -- never hand-edit either one. Until a dedicated
   CLI command exists for this, defer to what `validate`'s own report names
   as stale and state the derived-file rule to whoever reads the sweep's
   output.
5. Check CLAUDE.md pointer coverage with `okf-context`'s checklist, in both
   directions.
6. Tell the user what changed. Separately, list any concept step 3's
   `okfit validate` reported as `require-verified-unmet` as "awaiting human
   verification" and stop there — this skill never runs `okfit verify`.

## Ends by reporting, never committing

This skill never commits, never pushes, and never creates a changeset --
that stays a human's call (Spencer's standing rule), restated here because
this is the one skill in the group whose `allowed-tools` includes a
`Bash(...)` grant at all, and therefore the one place the commit boundary
could be crossed by accident. The grants above are scoped to `git diff:*`
and every real invocation form `okfit` is actually run through in this repo
-- direct (`okfit:*`), `pnpm exec okfit:*`, `npx okfit:*`, and
`node_modules/.bin/okfit:*` -- precisely so `git commit` is never
pre-approved -- running this skill to completion means describing what
changed and stopping there.
