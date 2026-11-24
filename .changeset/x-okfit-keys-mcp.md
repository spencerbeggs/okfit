---
"@okfit/mcp": minor
---

## Breaking Changes

- `describe_vocabulary` preset frontmatter keys use the prefixed names for the built-in profile fields.
- `get_concept.frontmatter` passes the file's frontmatter through, so it carries `x-okfit-integrity` and the prefixed profile keys; a bundle that has not been migrated shows the old keys until `okfit sync` runs.

The derived `integrity: current|drifted|none` signal keeps its name.
