# @okfit/plugin

Meta-package. Ships no behavior of its own; it exists so a consuming repo
installs one package and gets all three bins. The Claude Code plugin's
loaders (`plugins/claude-code`) run `okfit-mcp` and `okfit-lsp` from the
consuming repo's install of this package.

## Layout

```text
src/
  index.ts             -- OKFIT_BINS and PLUGIN_VERSION
  version.ts           -- PLUGIN_VERSION, read from process.env.__PACKAGE_VERSION__ (K-32), a
                          build-time constant the bundler injects
  bin/
    okfit.ts            -- the okfit bin shim: calls @okfit/cli/main's main({ distribution })
    okfit-mcp.ts          -- the okfit-mcp bin shim: awaits @okfit/mcp/main's main({ distribution })
    okfit-lsp.ts          -- the okfit-lsp bin shim: awaits @okfit/lsp/main's main({ distribution })
```

`src/bin/okfit.ts`, `src/bin/okfit-mcp.ts` and `src/bin/okfit-lsp.ts` are
the three bin shims: each imports `main` from its front end's `./main`
subpath (`@okfit/cli/main`, `@okfit/mcp/main`, `@okfit/lsp/main`) and
calls it with
`{ distribution: { name: "@okfit/plugin", version: PLUGIN_VERSION } }`.
That is the only way a report learns it was produced through this
package: `okfit --version` prints `via @okfit/plugin <version>` and every
`--format json` envelope carries `distribution`, while a direct install of
`@okfit/cli` or `@okfit/mcp` reports `distribution: null`. The engine
version (`engine_version`) and the OKF version are the numbers a reader
compares; this package's version is packaging
(`okf/decisions/engine-version-is-the-comparable-version-effected-kit.md`). `@okfit/cli`,
`@okfit/mcp` and `@okfit/lsp` are regular `dependencies`, not peers -- see
`okf/decisions/engine-front-end-split-effected-kit.md` for why a peer arrangement can
never produce a runnable bin here, and do not revert this to a peer
declaration.
