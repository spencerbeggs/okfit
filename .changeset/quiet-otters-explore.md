---
"@okfit/lsp": minor
---

## Features

* `okfit/concepts` request — answers with every discovered bundle's concepts for an editor's concept explorer: `{ id, uri, title, type, status, stale }` per concept, grouped under `{ root, rootUri, profile, concepts }` per bundle, from each live session's last-loaded snapshot
* `okfit/bundleChanged` notification — sent after a bundle root's diagnostics are republished (`reason: "revalidated"`) and after its session is dropped (`reason: "dropped"`), so a client knows when to re-fetch `okfit/concepts`
* `initialize`'s result now advertises `experimental: { okfitConcepts: true }` so a client can feature-detect both extensions
