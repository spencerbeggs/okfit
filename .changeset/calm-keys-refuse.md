---
"@okfit/lsp": patch
---

## Bug Fixes

* Mark verified on a concept whose content cannot be hashed (a frontmatter value holding an unpaired surrogate) now fails with a message naming the field, and the code action is omitted, instead of crashing the request.
