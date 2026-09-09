# @okfit/plugin

The one package to install for [okfit](https://github.com/spencerbeggs/okfit) in a repository. It brings the `okfit` CLI and the `okfit-mcp` server onto your PATH so the okfit Claude Code plugin can find them.

```bash
pnpm add -D @okfit/plugin
```

## Status

Both bins install. `okfit` has five subcommands (`validate`, `init`, `context`, `verify`, `sync`); `okfit-mcp` serves six read-only MCP tools plus static concept resources over stdio.

## License

[MIT](LICENSE)
