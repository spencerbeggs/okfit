---
"@okfit/ai-plugins": minor
---

## Features

### GitHub Copilot support

The okfit agent plugin is now available for GitHub Copilot as well as Claude Code, and the Copilot build is published to a Copilot marketplace starting with this release. The same skills, the `okf-docs` and `okf-publisher` agents, the session-start orientation and post-edit validation hooks, and the OKF MCP and LSP servers are available on both hosts. Tool and agent names are rendered per host, so the instructions read correctly in either one.

### Pluginfinity source

The plugin is now authored once as a host-neutral pluginfinity source and built into a Claude Code plugin and a Copilot plugin. Hooks run on the pluginfinity hook library, and the Claude Code build declares its MCP and LSP servers inline in `plugin.json`.

## Maintenance

* The plugin moved from `plugins/claude-code` to `plugin/`, and the package is renamed from `@okfit/claude-code-plugin` to `@okfit/ai-plugins`. Release tags are now `@okfit/ai-plugins@X`.
* Behavior on Claude Code is unchanged.
