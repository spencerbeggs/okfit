# @okfit/plugin

## 0.3.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/cli | dependency | updated | 0.4.1 | 0.5.0 |
| @okfit/mcp | dependency | updated | 0.3.2 | 0.3.3 |

## 0.3.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/cli | dependency | updated | 0.4.0 | 0.4.1 |
| @okfit/mcp | dependency | updated | 0.3.1 | 0.3.2 |

## 0.3.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/cli | dependency | updated | 0.3.0 | 0.4.0 |
| @okfit/mcp | dependency | updated | 0.3.0 | 0.3.1 |

## 0.3.0

### Bug Fixes

#### Installing the plugin now provides both bins

- `@okfit/plugin` previously declared `@okfit/cli` and `@okfit/mcp` as auto-installed peer dependencies. A package manager links `node_modules/.bin` entries only for an importer's direct dependencies — an auto-installed peer is resolvable but never runnable, so installing the plugin left a consumer's `node_modules/.bin/` with neither the `okfit` nor the `okfit-mcp` bin.

- `@okfit/cli` and `@okfit/mcp` are now regular `dependencies` of `@okfit/plugin`, and the plugin ships its own two bin shims under `src/bin/`, each importing `main` from the front end's `./main` subpath and calling it. Installing `@okfit/plugin` now links both `okfit` and `okfit-mcp` in `node_modules/.bin/`. [#28][#28]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/cli | dependency | updated | 0.2.0 | 0.3.0 |
| @okfit/mcp | dependency | updated | 0.2.0 | 0.3.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#28]: https://github.com/spencerbeggs/okfit/pull/28

## 0.2.1

### Bug Fixes

- Hoist mcp and cli packages as peers.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

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
