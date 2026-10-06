# okfit

Node.js tooling for the [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), built on [Effect](https://effect.website).

OKF is a directory of markdown files with YAML frontmatter that captures what a project is and should be, with provenance, trust, and lifecycle as first-class fields. okfit gives humans and agents a CLI, an MCP server, and a Claude Code plugin for authoring, validating, and querying those bundles.

## Packages

| Package | Purpose |
| --- | --- |
| `@okfit/core` | Spec-level schemas, bundle loading, link graph, validation |
| `@okfit/profiles` | Named configuration profiles, starting with `software-project` |
| `@okfit/cli` | The `okfit` command line |
| `@okfit/mcp` | The `okfit-mcp` Model Context Protocol server |
| `@okfit/lsp` | The okfit-lsp language server |
| `@okfit/plugin` | The one package to install in a repository |

The agent plugin lives in `plugin/`: one [pluginfinity](https://github.com/spencerbeggs/pluginfinity)
source built into a Claude Code plugin (`plugin/builds/claude/`) and a GitHub
Copilot plugin (`plugin/builds/copilot/`).

## Working with Claude Code

Run `pnpm claude` to start a session with this repository's own plugin
loaded (`claude --plugin-dir plugin/builds/claude`) -- ten skills, the
`okf-docs` and `okf-publisher` agents, the MCP and LSP servers, and the
session-start/validate hooks documented in `plugin/README.md`. After
editing anything under `plugin/`, run `pnpm plugin:build`.

## Status

Early development. Nothing is published yet.

## License

[MIT](LICENSE)
