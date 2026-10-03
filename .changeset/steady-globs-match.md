---
"@okfit/engine": minor
---

## Features

- `validate` now runs the publication lints (`publication-drift`, `publication-orphan`), so the CLI, MCP server, and language server report them.
- `validate` also checks each Surface's resource glob and reports `surface-unmatched` when it matches no files.
