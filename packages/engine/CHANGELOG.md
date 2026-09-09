# @okfit/engine

## 0.1.0

### Features

- New package. `@okfit/engine` holds the platform layer (`OkfitPlatform`, `OKFIT_APP_NAMESPACE`), config discovery and resolution, the JSON envelope contracts, and the validate/verify/sync/init/context programs that used to live inside `@okfit/cli`.

- `@okfit/cli` and `@okfit/mcp` are both direct consumers, each importing `@okfit/engine` rather than duplicating this logic or copy-contracting through the CLI

- Enforces its own boundary test: no file under `engine/src` may read `process`

- Assembles the same `OkfitPlatform` layer for both front ends, so the CLI and the MCP server resolve the same user-level config directory structurally [#28][#28]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#28]: https://github.com/spencerbeggs/okfit/pull/28
