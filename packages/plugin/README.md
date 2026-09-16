# @okfit/plugin

The one package to install for [okfit](https://github.com/spencerbeggs/okfit) in a repository. It brings the `okfit` CLI and the `okfit-mcp` server onto your PATH so the okfit Claude Code plugin can find them.

```bash
pnpm add -D @okfit/plugin
```

## Versions

`okfit --version` prints four numbers: `okfit 0.5.4 via @okfit/plugin 0.3.7 (engine 0.6.0, okf 0.2, config-schema 1.0)`. The engine, OKF, and config-schema versions are the ones that determine what a report says and what a config may contain; the CLI, MCP server, and this package version independently and are packaging. Every `--format json` report carries `engine_version`, `okf_version`, and `distribution`; `okfit context --format json` adds `config_schema_version`.

## Status

Both bins install. `okfit` has five subcommands (`validate`, `init`, `context`, `verify`, `sync`); `okfit-mcp` serves six read-only MCP tools plus static concept resources over stdio.

## License

[MIT](LICENSE)
