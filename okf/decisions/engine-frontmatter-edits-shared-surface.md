---
type: Decision
title: Frontmatter splices are a shared engine surface for the CLI's verify and the language server's actions
description: "@okfit/engine's edits/FrontmatterEdits.ts exposes the verify/locate.ts and verify/splice.ts splice machinery as a public, Context-free facade so @okfit/lsp's code actions and commands can compute the same byte-range edits okfit verify performs, instead of the splice modules staying CLI-private."
tags:
  - architecture
supersedes: cli-verify-splices-frontmatter.md
generated:
  by: okfit/claude-code
  at: 2026-09-23T21:50:18Z
  body_sha256: 6c0a6f220b99e8dfa67a35abb97e2234f23b8de0410d99964c67b2a62e79416e
status: draft
verified:
  - by: human:spencer
    at: 2026-09-24T00:30:18Z
---

# Frontmatter splices are a shared engine surface for the CLI's verify and the language server's actions

## Context

[okfit verify edits frontmatter by textual splice, never by
re-serialisation](cli-verify-splices-frontmatter.md) declared the splice
modules CLI-private, because at the time only `okfit verify` needed them.
LSP roadmap phase 5 added code actions and commands that must offer the
same edits -- `Set status: <status>` and `Mark verified by <actor>` -- from
inside the language server, for a client to apply through
`workspace/applyEdit` rather than `@okfit/engine` writing to disk itself
(`packages/lsp/CLAUDE.md`'s Code actions section). A second, independent
implementation of the same byte-range logic would drift from `okfit
verify`'s splice the first time either changed.

## Decision

Move the splice machinery's public surface into `@okfit/engine` as
`edits/FrontmatterEdits.ts`
(`packages/engine/src/edits/FrontmatterEdits.ts:49-81`): a `Context`-free
facade with `FrontmatterEdits.status(source, status)` and
`FrontmatterEdits.verified(source, entry)`, each returning
`MarkdownEdit`s at whole-file offsets into `source` as passed, BOM
included. Both methods reuse `verify/locate.ts`'s `locate`/
`locateTopLevelScalar` and `verify/splice.ts`'s `splice`/
`spliceTopLevelScalar` unchanged, so `FrontmatterEdits.verified`'s output
matches `okfit verify`'s own splice byte for byte -- same locate, same
splice, same `documentNewline` newline choice. A shape the splice does not
recognise fails closed with `UnsupportedFrontmatterError`, never a partial
write, mirroring the original decision's fail-closed posture.
`@okfit/lsp`'s `features/edits.ts` wraps this facade
(`statusTextEdits`/`verifiedTextEdits`) to convert each edit's offset to
an LSP range and applies it through `workspace/applyEdit`, never writing
to the bundle itself -- the same promise MCP and the language server's
diagnostics already make.

## Alternatives rejected

Keeping the splice modules CLI-private and hand-rolling a second
implementation in `@okfit/lsp` or `@okfit/engine`'s session layer: it
would duplicate `locate`/`splice`'s BOM handling, newline detection, and
shape-recognition fail-closed logic, and the two implementations could
answer differently for the same input the moment one changed without the
other. Having the language server shell out to `okfit verify`: it writes
to disk, which the language server's write-nothing promise forbids, and a
code action's edit must reach the client as a `WorkspaceEdit`, not a
file-system side effect.

## Consequences

`@okfit/engine`'s public barrel gains `FrontmatterEdits` and
`UnsupportedFrontmatterError`; the splice modules are no longer
CLI-private, though `okfit verify`'s own call sites are unchanged.
`@okfit/lsp`'s code actions, commands and the VS Code extension's `Set
Status…` and `Mark Verified` commands all compute edits through this one
facade, so a fix to the splice logic benefits every caller at once. The
byte-for-byte fixture corpus the original decision describes still
exercises the same `locate`/`splice` functions this facade calls, so its
guarantees carry forward unchanged.
