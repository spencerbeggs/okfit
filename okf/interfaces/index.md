# Interface

* [Claude Code plugin hooks contract](plugin-hooks-contract.md) - The two Claude Code plugin hooks (SessionStart, PostToolUse), their kill switches, and the CLI resolution order both share.
* [okfit CLI — validate, init, context, verify](cli-commands.md) - The okfit command line's four subcommands, their flags, exit codes, and JSON envelopes.
* [okfit config file schema](okfit-config-schema.md) - The .config/okfit/config.toml schema, its discovery order, and the defaults every key falls back to when unset.
* [okfit-mcp — MCP tool and resource contract](okfit-mcp.md) - The okfit-mcp server's six read-only tools, its two resource kinds, and the McpToolError union every tool declares.
