# Module

* [CLI](cli.md) - The okfit command line -- validate, init, context, and verify, built on effect/unstable/cli and @effected/cli.
* [Claude Code Plugin](claude-code-plugin.md) - The Claude Code plugin that teaches agents OKF v0.2 and keeps a repository's okf bundle current.
* [Core](core.md) - The no-internal-deps base package -- OKF v0.2 frontmatter schemas, bundle loading, the link graph, derivation, and validation, with no opinions about bundle content.
* [Engine](engine.md) - The shared okfit engine -- platform layer, config discovery, and the validate/verify/sync/init/context programs both the CLI and the MCP server depend on directly.
* [MCP](mcp.md) - The okfit-mcp Model Context Protocol server, exposing six read-only tools and static concept resources over stdio.
* [Plugin](plugin.md) - The meta-package a consuming repository installs to get both the okfit CLI and okfit-mcp bins on PATH.
* [Profiles](profiles.md) - The opinionated layer over core -- named okfit config profiles plus derivation rules for generated.at and generated.by.
* [Workspace](workspace.md) - The monorepo root -- workspace layout, shared rules, and the build, lint, and release commands every package uses.
