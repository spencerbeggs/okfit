---
"@okfit/cli": patch
---

## Bug Fixes

- `verify --at` accepts a date (`YYYY-MM-DD`, read as midnight UTC) as well as a timestamp with an explicit offset, and its help text says so.
- `validate` and `lint` no longer exit 2 for a bundle that holds a README, which is now skipped with a warning. A bundle whose only errors were `family-invalid` on spec-defined values now exits 0.
- `query --format json` may report a `status` of `unknown` for a concept whose status is outside the known vocabulary.
- A concept file that is a symbolic link resolving outside the bundle is no longer loaded or verifiable.
- `sync` keeps the root `index.md` frontmatter.
