---
"@okfit/profiles": minor
---

## Features

### Diagnostics now range at the offending value

`Provenance.lint`'s `generated-at-drift` diagnostic now ranges at the `generated.at` value itself (falling back to no range only when the concept has no frontmatter block), instead of carrying no range at all. The `software-project` profile's `project-multiple` and `project-not-at-root` diagnostics now range at the misplaced concept's `type` value; `project-missing`, being bundle-level rather than about one concept, still carries no range. Both changes use `@okfit/core`'s new `DiagnosticRange.forFrontmatterPath`, so an editor surfacing these diagnostics can now underline the actual value instead of the whole frontmatter block.
