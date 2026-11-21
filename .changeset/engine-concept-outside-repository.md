---
"@okfit/engine": patch
---

## Bug Fixes

- `okfit sync --staged` resolves repository-relative paths with `relativeWithin` and fails with `ConceptOutsideRepositoryError` for a concept or `log.md` that resolves outside the repository, instead of silently skipping it. Validate and session revalidate carry the new error in their failure unions.
