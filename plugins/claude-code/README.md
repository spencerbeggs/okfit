# okfit Claude Code plugin

Teaches Claude Code the [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) v0.2 and keeps a repository's `okf/` bundle current.

## Local development

From the repository root:

```bash
pnpm claude
```

This starts Claude Code with `--plugin-dir plugins/claude-code`.

## Status

Manifest only. Skills, the `okf-docs` agent, hooks, and the MCP loader land in later releases.
