# @okfit/plugin

Meta-package. Ships no behavior of its own; it exists so a consuming repo
installs one package and gets both bins. The Claude Code plugin's loader
(`plugins/claude-code`) runs `okfit-mcp` from the consuming repo's install of
this package.

## Layout

```text
src/
  index.ts    -- OKFIT_BINS constant only
```
