# okfit Claude Code plugin

Private, release-only workspace package. `package.json` exists so changesets
can version it; `.changeset/config.json` mirrors `$.version` into
`.claude-plugin/plugin.json`. Tags are cut, nothing publishes to npm.
Distribution is through the `spencerbeggs/bot` marketplace (not yet listed).

## Planned layout

```text
.claude-plugin/plugin.json   -- manifest (mcpServers block added with the loader)
skills/<name>/SKILL.md       -- okf-spec, okf-authoring, okf-config, okf-context, okf-finalize, npm-readme
agents/okf-docs.md           -- the one agent owning the bundle and context files
hooks/hooks.json             -- SessionStart orientation, PreToolUse validate
hooks/lib/                   -- shared bash helpers
bin/start-mcp.sh             -- zero-dependency loader that runs okfit-mcp from the repo's install
__test__/*.bats              -- BATS coverage for hooks and manifest
```

Never add `verified` entries to a concept from this plugin; only humans do
that through `okfit verify`.
