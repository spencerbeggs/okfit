# @okfit/plugin

Meta-package. Ships no behavior of its own; it exists so a consuming repo
installs one package and gets both bins. The Claude Code plugin's loader
(`plugins/claude-code`) runs `okfit-mcp` from the consuming repo's install of
this package.

## Layout

```text
src/
  index.ts             -- OKFIT_BINS and PLUGIN_VERSION
  version.ts           -- PLUGIN_VERSION, read from process.env.__PACKAGE_VERSION__ (K-32), a
                          build-time constant the bundler injects
  bin/
    okfit.ts            -- the okfit bin shim: calls @okfit/cli/main's main({ distribution })
    okfit-mcp.ts          -- the okfit-mcp bin shim: awaits @okfit/mcp/main's main({ distribution })
```

`src/bin/okfit.ts` and `src/bin/okfit-mcp.ts` are the two bin shims: each
imports `main` from its front end's `./main` subpath
(`@okfit/cli/main`, `@okfit/mcp/main`) and calls it with
`{ distribution: { name: "@okfit/plugin", version: PLUGIN_VERSION } }`.
That is the only way a report learns it was produced through this
package: `okfit --version` prints `via @okfit/plugin <version>` and every
`--format json` envelope carries `distribution`, while a direct install of
`@okfit/cli` or `@okfit/mcp` reports `distribution: null`. The engine
version (`engine_version`) and the OKF version are the numbers a reader
compares; this package's version is packaging
(`okf/decisions/engine-version-is-the-comparable-version.md`). `@okfit/cli` and
`@okfit/mcp` are regular `dependencies`, not peers -- see
`okf/decisions/engine-front-end-split.md` for why a peer arrangement can
never produce a runnable bin here, and do not revert this to a peer
declaration.
