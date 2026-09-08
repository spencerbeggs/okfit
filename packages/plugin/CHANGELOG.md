# @okfit/plugin

## 0.2.0

### Features

- First usable release of `@okfit/plugin`: the one package to install for okfit in a repository. It brings the `okfit` CLI and the `okfit-mcp` server onto `PATH` in a single install, so the Claude Code plugin can find them without any further setup.

```bash
pnpm add -D @okfit/plugin
```

- Installing it gives a repository both bins, `okfit` and `okfit-mcp`, backed by `@okfit/cli` and `@okfit/mcp` respectively. [#16][#16]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/cli | dependency | updated | 0.1.0 | 0.2.0 |
| @okfit/mcp | dependency | updated | 0.1.0 | 0.2.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#16]: https://github.com/spencerbeggs/okfit/pull/16

## 0.1.0

### Features

- Bootstrap the okfit monorepo with package skeletons for core, profiles, cli, mcp, plugin, and the Claude Code plugin.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/cli | dependency | updated | 0.0.0 | 0.1.0 |
| @okfit/mcp | dependency | updated | 0.0.0 | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!
