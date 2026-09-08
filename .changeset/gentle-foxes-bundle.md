---
"@okfit/plugin": minor
---

## Features

First usable release of `@okfit/plugin`: the one package to install for okfit in a repository. It brings the `okfit` CLI and the `okfit-mcp` server onto `PATH` in a single install, so the Claude Code plugin can find them without any further setup.

```bash
pnpm add -D @okfit/plugin
```

Installing it gives a repository both bins, `okfit` and `okfit-mcp`, backed by `@okfit/cli` and `@okfit/mcp` respectively.
