# @okfit/engine

The shared engine behind [okfit](https://github.com/spencerbeggs/okfit): the platform layer, config discovery, and the `validate`, `verify`, `sync`, `init` and `context` programs, plus the JSON envelope contracts that `@okfit/cli` and `@okfit/mcp` both emit.

You probably want `@okfit/plugin` (both bins), `@okfit/cli` (the `okfit` bin) or `@okfit/mcp` (the `okfit-mcp` bin) instead. This package is what they are built from.

`FrontmatterEdits` is a public facade over the `verify` splice machinery: it produces `MarkdownEdit`s for a concept's top-level `status` scalar and its `verified` list, with whole-file offsets into the source as passed (BOM included), so a consumer such as `@okfit/lsp` can apply them directly or map them to editor ranges without adjustment.

## License

[MIT](LICENSE)
