---
"@okfit/mcp": minor
---

## Features

`@okfit/mcp` no longer depends on `@okfit/cli`. It now depends on `@okfit/engine` directly for the platform layer, config discovery, and the validate/verify/sync/init/context programs it needs.

* `pnpm add -D @okfit/mcp` no longer resolves `@effected/cli` or the CLI's command tree
* `@okfit/mcp` continues to resolve the same user-level config directory as `@okfit/cli`, since both now provide the same `@okfit/engine` `OkfitPlatform` layer
