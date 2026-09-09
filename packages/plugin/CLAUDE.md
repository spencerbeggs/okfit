# @okfit/plugin

Meta-package. Ships no behavior of its own; it exists so a consuming repo
installs one package and gets both bins. The Claude Code plugin's loader
(`plugins/claude-code`) runs `okfit-mcp` from the consuming repo's install of
this package.

## Layout

```text
src/
  index.ts             -- OKFIT_BINS constant only
  bin/
    okfit.ts            -- the okfit bin shim: imports and calls @okfit/cli/main's main()
    okfit-mcp.ts          -- the okfit-mcp bin shim: imports and awaits @okfit/mcp/main's main()
```

`src/bin/okfit.ts` and `src/bin/okfit-mcp.ts` are the two bin shims: each
imports `main` from its front end's `./main` subpath
(`@okfit/cli/main`, `@okfit/mcp/main`) and calls it. `@okfit/cli` and
`@okfit/mcp` are regular `dependencies`, not peers -- see
`okf/decisions/engine-front-end-split.md` for why a peer arrangement can
never produce a runnable bin here, and do not revert this to a peer
declaration.
