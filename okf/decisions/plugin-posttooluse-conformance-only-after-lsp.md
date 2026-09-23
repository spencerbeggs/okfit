---
type: Decision
title: The PostToolUse hook keeps only conformance blocking and the generated.by check, once the language server delivers lint and profile findings
description: LSP phase 4 shrinks the Claude Code plugin's PostToolUse hook to two jobs, blocking on a core.conformance diagnostic and the Write-time generated.by check, because the registered language server now delivers core.lint and profile findings with precise ranges directly in the editor.
supersedes: plugin-posttooluse-not-pretooluse.md
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-23T08:32:55Z
  body_sha256: ed8d8dfccaa08e0742894b5850daab0049f22238f2b959e5f40806b9cbdb31ad
status: draft
---

# The PostToolUse hook keeps only conformance blocking and the generated.by check, once the language server delivers lint and profile findings

## Context

[The validate hook fires PostToolUse, not
PreToolUse](plugin-posttooluse-not-pretooluse.md) established that the
hook runs `okfit validate <project_root> --format json` once per write,
filters the diagnostics to the edited file, blocks
(`decision: "block"`) on a `core.conformance` hit, and warns
(`additionalContext`) on a `core.lint`/profile-only hit. That second
channel duplicated every lint and profile finding into the agent's
context on every `Write`/`Edit`, with no range: the hook can only say
"this file has a problem", never where. [LSP](../modules/lsp.md) phase 4
gave `@okfit/lsp` precise diagnostic ranges (every core lint rule that
knows its field, and profiles' and engine's drift, project and resource
diagnostics, anchors at the offending value) plus hover, document links,
definition, references and workspace symbols, and the Claude Code plugin
registers it as `lspServers.okfit` for the `.md` extension. A registered
language server pushes its diagnostics into the model's context on the
next edit without a tool call, the same delivery the hook's
`additionalContext` channel existed to approximate.

## Decision

The `PostToolUse` hook keeps exactly two jobs from here: it still runs
`okfit validate --skip-provenance` on the whole bundle and filters to
the edited file, but now turns only a `core.conformance` hit into
`{"decision": "block", ...}`; every other diagnostic for that file —
`core.lint`, profile findings — is silent at the hook and no longer
emitted as `additionalContext`. The hook's other job is unchanged: when
the config sets `actors.agent`, a concept file (never `index.md` or
`log.md`) whose frontmatter has no `generated.by` blocks on `Write` and
warns on `Edit`, with the exact `by:` value to add in the message
([#74](https://github.com/spencerbeggs/okfit/issues/74)) — the hook is
the one place that knows the write came from the agent, which the
language server has no way to know. Lint and profile findings are now
delivered exclusively by the registered language server, with ranges the
hook's whole-file grep-and-filter approach could never produce.

## Alternatives rejected

Keeping both channels — the hook's `additionalContext` warning alongside
the server's ranged diagnostic — would duplicate every lint and profile
finding into the agent's context on every write, once rangeless from the
hook and once precise from the server, for no benefit once the server
covers the same diagnostics with strictly more information. Moving the
`core.conformance` block itself to the server was rejected too: a
language server publishes diagnostics, it does not gate a tool call: LSP
has no protocol member that lets a `textDocument/publishDiagnostics`
push block the `Write` that produced it, so a structurally broken
concept would land on disk with no way to stop it landing. The
`PostToolUse` hook is the only surface in this plugin positioned after
the write and before control returns to the agent, so conformance
blocking and the `generated.by` check — both need-to-block checks — stay
there.

## Consequences

An agent editing `okf/**` under Claude Code now sees lint and profile
findings only through the language server's diagnostics push, never
through hook `additionalContext`; a `core.conformance` violation and a
missing `generated.by` still surface through the hook exactly as before.
`plugins/claude-code/__test__/post-tool-use-validate.bats` covers the
new silence directly (the tests tagged "LSP phase 4, decision 8" in that
file). A client that does not register `@okfit/lsp` — or a session where
another markdown language server shadowed it — sees no lint or profile
feedback at all until the next `okfit validate` run; that gap is
accepted for the same reason the original PostToolUse-not-PreToolUse
decision accepted validating bytes only after they exist on disk: the
alternative was building surface nothing else in the plan needed.

## Verification

Not yet verified by a human; Spencer should confirm this reflects the
intended phase 4 trade-off and run `okfit verify` on this concept
himself.
