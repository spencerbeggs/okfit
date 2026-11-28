---
"@okfit/core": patch
---

## Bug Fixes

- A symbolic link in the bundle to a device, FIFO or socket stays silent and is never read. `@effected/walker` 0.32 now reports such links, and without this fix one that points out of the bundle (`notes.md -> /dev/null`) was misreported as a `symlink-escape` directory link.

## Refactoring

- An unquoted `okf_version` is read from its source text through `@effected/yaml`'s `YamlScalar.sourceText` instead of slicing offsets by hand. Output is unchanged.
