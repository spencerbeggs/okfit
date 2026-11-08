---
"@okfit/lsp": patch
---

## Build System

* Builds with `effected package build` instead of `@savvy-web/bundler`. The published artifact's shape and paths are unchanged.
* Each bin entry registers tsx itself when it runs as TypeScript source; the published JavaScript is unaffected.
