---
"@okfit/engine": minor
"okfit": patch
"@okfit/mcp": patch
---

## Features

* The `okfit validate --format json` envelope (and the MCP `validate_bundle` report, which reuses it) gains a `producer` field naming the package that produced the report: `okfit` from the CLI, `@okfit/mcp` from the MCP server. `okfit_version` was already that package's own version, so the two reports over one bundle legitimately differ there; `producer` labels why.
