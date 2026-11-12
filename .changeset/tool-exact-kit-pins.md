---
"@okfit/cli": patch
"@okfit/mcp": patch
"@okfit/lsp": patch
"@okfit/engine": patch
---

## Build System

* Pins every `effect`, `@effect/*` and `@effected/*` runtime dependency to an exact version instead of a caret. An installed okfit now runs exactly the kit it was tested with: a newer kit patch reaches it only through a new okfit release, and okfit no longer conflicts with a host repository that has moved to a newer Effect or kit release.
