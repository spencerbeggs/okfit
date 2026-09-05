# @okfit/core

## 0.2.0

### Features

- Implement OKF v0.2 support: frontmatter schemas, bundle loading, link graph, derivation, validation, and the `OkfitConfig` schema with `OkfitConfigFile`.

### Bug Fixes

- `Timestamp` now encodes a whole-second instant as `2026-03-01T08:00:00Z`, without the `.000` millisecond component, so written stamps read like git's dates and the OKF sample bundles; non-zero milliseconds are kept and decoding is unchanged.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.0

### Features

- Bootstrap the okfit monorepo with package skeletons for core, profiles, cli, mcp, plugin, and the Claude Code plugin.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!
