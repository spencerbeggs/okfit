---
"@okfit/mcp": patch
---

## Features

- `validate_bundle`'s result gains `summary.migration_findings`, always present. It is `0` because the tool has no `target` input. A client that checks the report against a closed shape must allow the new field.
- `validate_bundle` reports the new `non-concept-unlisted` lint, which flags a Markdown file with no frontmatter or no `type` that matches no `[bundle] non_concepts` glob. It is silent unless the project sets `non_concepts`.
