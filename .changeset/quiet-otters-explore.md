---
"@okfit/lsp": minor
---

## Features

* `okfit/concepts` request — answers with every discovered bundle's concepts for an editor's concept explorer: `{ id, uri, title, type, status, stale }` per concept, grouped under `{ root, rootUri, profile, concepts }` per bundle, from each live session's last-loaded snapshot; the request warms up every workspace folder that has never been resolved on demand, so a client asking before any document is open still gets a populated result
* `okfit/bundleChanged` notification — sent after a bundle root's diagnostics are republished (`reason: "revalidated"`) and after its session is dropped (`reason: "dropped"`), so a client knows when to re-fetch `okfit/concepts`
* `initialize`'s result now advertises `experimental: { okfitConcepts: true }` so a client can feature-detect both extensions
* `textDocument/codeAction` — `Set status: <status>` actions (one per status the concept's frontmatter does not already name, all three when it names none) and a `Mark verified by <actor>` action when a human actor resolves, offered when the request range touches the frontmatter or `context.only` asks for them; a `status-missing` diagnostic adds `Set status: draft` (preferred) and `Set status: stable` quick fixes
* Every edit a code action or command produces is computed against the document's current editor text; a command's edit is also sent as a versioned `documentChanges` entry, so the editor refuses it once the buffer has moved on -- a code action's edit carries no version (the client drops it), and stays safe only because it is recomputed from the current buffer on each request
* `workspace/executeCommand` — `okfit.lsp.setStatus [uri, status]`, `okfit.lsp.markVerified [uri]` (edits sent to the client through `workspace/applyEdit`, never written to disk), and `okfit.lsp.revalidate [rootUri?]` for an on-demand `full` revalidate
* `textDocument/inlayHint` — a trust/staleness hint after `status:` (or `type:` when `status` is absent) and a `generated.at` age hint, both from the last-loaded snapshot
* `initialize`'s result now also advertises `codeActionProvider`, `executeCommandProvider` and `inlayHintProvider`, naming the command ids and code action kinds in `features/names.ts`'s `OKFIT_COMMANDS`/`OKFIT_CODE_ACTION_KINDS`
