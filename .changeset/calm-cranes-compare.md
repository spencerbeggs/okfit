---
"@okfit/claude-code-plugin": patch
---

## Documentation

The `okf-docs` agent and the `okf-finalize` skill now tell an agent how to read the versions on a validation report: compare `engine_version` and `okf_version` between the `validate_bundle` tool and `okfit validate --format json`, and never read a differing `okfit_version` as drift — that field is each front end's own version, and the CLI and MCP server version independently.
