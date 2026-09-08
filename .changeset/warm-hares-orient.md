---
"@okfit/claude-code-plugin": minor
---

## Features

First usable release of the okfit Claude Code plugin: teaches Claude Code the Open Knowledge Format (OKF) v0.2 and keeps a repository's `okf/` bundle current.

### Six skills

`okf-spec` (an OKF v0.2 condensed reference), `okf-authoring` (sixteen imperative rules for writing and editing concept files), `okf-config` (the okfit config file, table by table), `okf-context` (CLAUDE.md-as-router checklist), `okf-finalize` (branch-end sweep: reconcile touched concepts, run `okfit validate`, regenerate derived files), and `npm-readme` (package README shape and section order). Every skill is both user- and model-invocable.

### The `okf-docs` agent

`agents/okf-docs.md` keeps a repository's `okf/` bundle and its CLAUDE.md pointer files current under the resolved config's own type and tag vocabulary, preloading all six skills above. It never touches `verified`, never edits anything outside the bundle, CLAUDE.md files, and package READMEs, and never commits, pushes, or writes a changeset.

### Two hooks

`SessionStart` (`hooks/session-start/orientation.sh`) runs `okfit context --format json` once per session and injects the bundle root, profile, and vocabulary into `additionalContext`. `PostToolUse` (`hooks/post-tool-use/validate.sh`) runs after a `Write` or `Edit` under the bundle root, validates the edited file, and blocks on a conformance error while surfacing a lint diagnostic as a non-blocking warning. Both hooks can be disabled with `OKFIT_HOOKS=off`, or individually with `OKFIT_SESSION_HOOK=off` / `OKFIT_VALIDATE_HOOK=off`.

### MCP loader

`.claude-plugin/plugin.json` registers `mcpServers.mcp`, running `bin/start-mcp.sh`, which resolves the project's own installed `okfit-mcp` and falls back to `npx --yes @okfit/mcp` when it is not installed — giving the plugin's agent and any other MCP client access to the six read-only tools and bundle resources `@okfit/mcp` exposes.
