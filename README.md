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
| `@okfit/plugin` | The one package to install in a repository |

The Claude Code plugin lives in `plugins/claude-code`.

## Status

Early development. Nothing is published yet.

## License

[MIT](LICENSE)
