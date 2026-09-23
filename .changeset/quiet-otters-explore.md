---
"@okfit/lsp": minor
---

## Features

* `okfit/concepts` request — answers with every discovered bundle's concepts for an editor's concept explorer: `{ id, uri, title, type, status, stale }` per concept, grouped under `{ root, rootUri, profile, concepts }` per bundle, from each live session's last-loaded snapshot; the request warms up every workspace folder that has never been resolved on demand, so a client asking before any document is open still gets a populated result
* `okfit/bundleChanged` notification — sent after a bundle root's diagnostics are republished (`reason: "revalidated"`) and after its session is dropped (`reason: "dropped"`), so a client knows when to re-fetch `okfit/concepts`
* `initialize`'s result now advertises `experimental: { okfitConcepts: true }` so a client can feature-detect both extensions
* `textDocument/codeAction` — `Set status: <status>` actions (one per status the concept is not already in) and a `Mark verified by <actor>` action when a human actor resolves; every status action promotes to a `quickfix` on a `status-missing` diagnostic, with `draft` marked `isPreferred`
* `workspace/executeCommand` — `okfit.setStatus [uri, status]`, `okfit.markVerified [uri]` (edits sent to the client through `workspace/applyEdit`, never written to disk), and `okfit.revalidate [rootUri?]` for an on-demand `full` revalidate
* `textDocument/inlayHint` — a trust/staleness hint after `status:` (or `type:` when `status` is absent) and a `generated.at` age hint, both from the last-loaded snapshot
* `initialize`'s result now also advertises `codeActionProvider`, `executeCommandProvider` and `inlayHintProvider`, naming the command ids and code action kinds in `features/names.ts`'s `OKFIT_COMMANDS`/`OKFIT_CODE_ACTION_KINDS`
