# okfit Claude Code plugin

Private, release-only workspace package. `package.json` exists so changesets
can version it; `.changeset/config.json` mirrors `$.version` into
`.claude-plugin/plugin.json`. Tags are cut, nothing publishes to npm.
Distribution is through the `spencerbeggs/bot` marketplace (not yet listed).

## Layout

```text
plugins/claude-code/
  .claude-plugin/
    plugin.json                        -- manifest; mcpServers.mcp -> bin/start-mcp.sh
  package.json                         -- @okfit/claude-code-plugin, private, version mirror
  CHANGELOG.md                         -- untouched (no changesets until Spencer calls the release)
  README.md                            -- Local development/Skills/Agent/Hooks/MCP-loader/Status sections
  CLAUDE.md                            -- this file
  skills/
    okf-spec/SKILL.md                  -- OKF v0.2 condensed reference
    okf-authoring/SKILL.md             -- sixteen authoring imperatives
    okf-config/SKILL.md                -- TOML schema by table, profiles
      references/example-config.toml
    okf-context/SKILL.md               -- CLAUDE.md-as-router checklist
    okf-finalize/SKILL.md              -- branch-end sweep
    npm-readme/SKILL.md                -- README order, shape detection, badges
      references/badge-formats.md
  agents/
    okf-docs.md                        -- the one agent; preloads all six skills
  hooks/
    hooks.json                         -- SessionStart (no matcher) + PostToolUse (Write|Edit)
    lib/
      hook-output.sh                   -- the fd-3 fence + six emitters
      okfit-cli.sh                     -- okfit_cli / okfit_project_dir
    session-start/
      orientation.sh                   -- one `okfit context` call, builds additionalContext
    post-tool-use/
      validate.sh                      -- bundle-scoped; context then validate
    fixtures/
      sessionstart.{startup,resume,clear,compact}.json
      posttooluse.{write-clean,edit-clean,edit-index,write-outside,read-ignored}.json
  bin/
    start-mcp.sh                       -- POSIX sh loader; pm detect, exec local bin, npx fallback
  __test__/
    manifest.bats
    session-start-orientation.bats
    post-tool-use-validate.bats
    agent-skill-registration.bats
    hooks-json.bats
    loader.bats
    lib/
      render-fixture.sh                -- __REPO_ROOT__ substitution
    fixtures/
      bundles/clean/                   -- tiny synthetic bundle for the one real-CLI smoke test (conformant baseline, then broken on purpose)
```

`hooks/fixtures/` holds Claude Code stdin envelopes only — what the platform
would actually send a hook on stdin. `__test__/fixtures/` holds everything
else a `.bats` file needs on disk: fake bundle trees, canned `okfit`
envelopes, and `PATH` shims. Do not put one kind of fixture under the
other's directory.

Kill switches: `OKFIT_HOOKS=off` disables both hooks; `OKFIT_SESSION_HOOK=off`
and `OKFIT_VALIDATE_HOOK=off` disable one each. Comparison is exact-string
`off` only — no `0`/`false` widening. `hooks/lib/okfit-cli.sh#okfit_cli`
resolves the CLI in exactly this order: `$OKFIT_CLI_CMD` (a command string,
word-split, unquoted at the call site so a multi-word override works — the
BATS stubbing seam) → `<project_dir>/node_modules/.bin/okfit` → `okfit` on
`PATH`. If none resolves, the function returns `1` and prints nothing; hooks
never fall back to `npx`.

`orientation.sh` bounds two blocks it injects into `additionalContext`,
each with the same truncation-line pattern: the bundle's `index.md` at
12,000 bytes, and the combined types+tags vocabulary block at 8,000 bytes
(Minor 10, final review). Either can still push the whole field over the
platform's own 10,000-character cap when both are near their own limit;
that overflow is the platform's file-and-preview fallback to handle, not
something these two caps guarantee against on their own.

`hooks/hooks.json` declares `SessionStart` orientation (no matcher) and
`PostToolUse` validate on `Write|Edit` — **not** `PreToolUse`: `PreToolUse`
fires before the edited file exists on disk, and `okfit validate` has
nothing to read at that point. The write has already landed by the time
`PostToolUse` fires, so a block from that hook is a stop-and-fix signal, not
a prevention. Both hook `command` entries in `hooks.json` invoke their
script as `bash "${CLAUDE_PLUGIN_ROOT}/hooks/..."` rather than executing it
directly, because the repo strips executable bits on commit.

`.claude-plugin/plugin.json` registers `mcpServers.mcp`, running
`bin/start-mcp.sh`, which exposes the six tools named explicitly in
`agents/okf-docs.md`'s `tools:` block.

Run the BATS suite with `pnpm test:bats` from the repo root (covers every
`.bats` file under `__test__/`), or a single file directly with
`pnpm exec bats <file>`.

Never add `verified` entries to a concept from this plugin. `okfit verify`
exists and is a human-run CLI command; this plugin's agent and hooks never
invoke it and never write `verified` themselves.
