---
"@okfit/plugin": minor
---

## Bug Fixes

### Installing the plugin now provides both bins

`@okfit/plugin` previously declared `@okfit/cli` and `@okfit/mcp` as auto-installed peer dependencies. A package manager links `node_modules/.bin` entries only for an importer's direct dependencies — an auto-installed peer is resolvable but never runnable, so installing the plugin left a consumer's `node_modules/.bin/` with neither the `okfit` nor the `okfit-mcp` bin.

`@okfit/cli` and `@okfit/mcp` are now regular `dependencies` of `@okfit/plugin`, and the plugin ships its own two bin shims under `src/bin/`, each importing `main` from the front end's `./main` subpath and calling it. Installing `@okfit/plugin` now links both `okfit` and `okfit-mcp` in `node_modules/.bin/`.
