---
"@okfit/claude-code-plugin": minor
---

## Features

### LSP server registration

`.claude-plugin/plugin.json` now registers `lspServers.okfit`, wired to
the `.md` extension with `diagnostics: true`. A new loader,
`bin/start-lsp.sh`, resolves the project's own
`node_modules/.bin/okfit-lsp` and falls back to `npx --yes @okfit/lsp`
when it is not installed — the same shape as the existing MCP loader.

The server starts lazily, on the first `Edit` or `Write` of a `.md` file
in the session, and publishes diagnostics for every bundle file whose
diagnostic set changed. Diagnostics from this server are advisory only:
unlike the plugin's `PostToolUse` hook, nothing here blocks a tool call.
Claude Code runs at most one language server per file extension per
session, so another markdown LSP plugin loaded earlier may shadow this
one entirely.
