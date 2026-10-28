---
"@okfit/lsp": minor
---

## Breaking Changes

`uriToPath` and `pathToUri` are no longer exported from `@okfit/lsp`. They were conversion helpers internal to the server; the server itself is unaffected. If you imported them, use `LspUri.toPath` and `LspUri.fromPath` from `@effected/lsp`, which the server now uses itself.

## Bug Fixes

* `file:` URIs the server sends on Windows now use a lowercase drive letter and a literal colon (`file:///c:/...`). On every platform, characters outside RFC 3986's unreserved set (such as `@`, `+`, `(`, `'`) are now percent-encoded in the `uri` and `rootUri` the server sends. A client that compares them as strings should normalize both sides first, as the okfit extension does.
* Hover resolves the correct line in documents that use bare CR line endings.
