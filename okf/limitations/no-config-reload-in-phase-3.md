---
type: Limitation
title: The phase 3 language server does not reload a changed config or clear a dropped session's diagnostics
description: A config change drops a folder's session without revalidating, and a dropped session never clears what it published, so diagnostics go stale until the next document event; Claude Code sends neither notification that triggers the path, so a config edit there needs a session restart.
status: deprecated
bounds: ../modules/lsp.md
tags:
  - dx
sources:
  - id: diagnostics-feature
    resource: ../../packages/lsp/src/features/diagnostics.ts
  - id: session-registry
    resource: ../../packages/lsp/src/session/registry.ts
  - id: lsp-roadmap
    resource: ../roadmaps/lsp-server-and-vscode-extension.md
generated:
  by: okfit/claude-code
  at: 2026-09-23T08:11:07Z
  body_sha256: 45fa900c2ac1fe2eee016c8a823c34dcade2e45740aafb2a54d5323403451b95
---

# The phase 3 language server does not reload a changed config or clear a dropped session's diagnostics

## Condition

The language server registers no file watchers of its own. It sees a
config change only when the client sends
`workspace/didChangeWatchedFiles` naming a config discovery file under a
workspace folder. The handler then drops that folder's session and
schedules nothing[^diagnostics-feature]. A folder is also dropped when
`workspace/didChangeWorkspaceFolders` removes it[^session-registry].

## Symptom

- After a config change, nothing is republished until the next document
  event for that folder. The rebuilt session starts with an empty record
  of what it published, so a file that had diagnostics under the old
  config and has none under the new one never receives `[]`. Its stale
  warnings stay in the client.
- After a folder is removed, every diagnostic it published stays in the
  client.
- The rebuilt session starts without the overlays of documents still
  open with unsaved text, so it validates their disk contents until the
  next `didChange` for each.

A folder whose config failed to load is different: it is retried on
`didOpen`, `didSave` and any watched-file change under it, so fixing the
config and saving a document recovers it.

## Why it is acceptable now

Claude Code, the only client phase 3 targets, sends neither
`workspace/didChangeWatchedFiles` nor `workspace/didChangeWorkspaceFolders`,
so the path never runs there. The flip side is that under Claude Code a
config edit is never seen at all: the running server keeps the config it
first loaded, and picking up the edit needs a session restart.

## The fix

On a config change, rebuild the folder's session and schedule a full
revalidate instead of only dropping it. Have the publisher remember the
URIs each session last published non-empty, and publish `[]` for each of
them when the session is disposed. Carry the open documents' overlays
into the rebuilt session. This is queued as the first item of phase 4 in
the [LSP roadmap](../roadmaps/lsp-server-and-vscode-extension.md)[^lsp-roadmap],
and it must land before phase 6, since VS Code sends both notifications.

[^diagnostics-feature]: `../../packages/lsp/src/features/diagnostics.ts`
[^session-registry]: `../../packages/lsp/src/session/registry.ts`
[^lsp-roadmap]: `../roadmaps/lsp-server-and-vscode-extension.md`

## Discharged

Phase 4 (2026-09-23) shipped the fix described above: on a config-file
watched change, `registry.rebuild(folder)` disposes the folder's old
session, carries its open document overlays into the fresh one, and
schedules a full revalidate; the publisher remembers, per session root,
every URI it last published non-empty and publishes `[]` for each of
them when that session is disposed, whether by a config rebuild or by
`workspace/didChangeWorkspaceFolders` removing the folder. See
[LSP](../modules/lsp.md).
