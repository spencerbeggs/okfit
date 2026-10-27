---
"@okfit/engine": patch
---

## Bug Fixes

- The editor overlay (`layerOverlayFileSystem`, used by the language server and by `okfit validate --document`) now answers `lstat` for an open document as well as `stat`. `@effected/walker` 0.21 `lstat`s every entry it walks and skips one that is not found, so a new, unsaved concept was left out of the bundle and got no diagnostics until it was saved.
