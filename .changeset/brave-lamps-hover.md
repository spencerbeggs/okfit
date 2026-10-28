---
"@okfit/lsp": minor
---

## Breaking Changes

`uriToPath` and `pathToUri` are no longer exported from `@okfit/lsp`. They were conversion helpers internal to the server; the server itself is unaffected. If you imported them, use `LspUri.toPath` and `LspUri.fromPath` from `@effected/lsp`, which the server now uses itself.

## Bug Fixes

* `file:` URIs the server sends on Windows now use a lowercase drive letter and a literal colon (`file:///c:/...`). Clients compare them by path, so matching is unaffected.
* Hover resolves the correct line in documents that use bare CR line endings.
* Non-integer positions sent by a client no longer throw.
