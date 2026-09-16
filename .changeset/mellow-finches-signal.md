---
"@okfit/plugin": minor
---

## Features

Exports `PLUGIN_VERSION`, this package's own version. Both bins (`okfit`, `okfit-mcp`) now pass `{ distribution: { name: "@okfit/plugin", version: PLUGIN_VERSION } }` to the underlying CLI/MCP server's `main()`, so every report produced through this meta-package identifies it in the JSON envelope's `distribution` field.
