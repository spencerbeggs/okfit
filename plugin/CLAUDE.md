# okfit agent plugin (pluginfinity source)

The pluginfinity source of the okfit plugin. `pluginfinity build` turns it
into a Claude Code plugin (`builds/claude/`) and a GitHub Copilot plugin
(`builds/copilot/`). It is the private workspace package
`@okfit/ai-plugins`, which exists only for changesets versioning: its
version is every built manifest's version, and `.changeset/config.json`
mirrors a bump into both built `plugin.json` files. Releases are tagged
`@okfit/ai-plugins@<version>`. The `pluginfinity` CLI and bats helper come
from the repository root's `node_modules`.

Never edit a file under `builds/`: edit the source, run `pnpm plugin:build`
from the repo root, and commit `builds/` with it. `pnpm plugin:check`
fails when `builds/` differs from a fresh build. Never write a
`hooks.json`, a manifest, or a server file by hand (Claude servers are
written inline into `plugin.json`; never ship a root `.mcp.json` or
`.lsp.json`, which the build rejects), and never
create `hooks/lib/pluginfinity/` — the build writes all of them. Biome and
markdownlint ignore `plugin/builds/**` so commit-time formatting never
drifts the build.

## Layout

```text
plugin/
  pluginfinity.config.ts               -- name, metadata, hooks, MCP + LSP servers, targets
  package.json                         -- its version is every built manifest's version
  CHANGELOG.md, README.md, CLAUDE.md   -- not shipped
  skills/<name>/SKILL.md               -- ten skills; a `targets.copilot` block only where `Bash(...)` rules must collapse to `Bash`
  agents/okf-docs.md, okf-publisher.md -- tool names and `{{tool …}}`/`{{agent …}}` body tokens render per host
  hooks/
    lib/okfit/okfit-cli.sh             -- okfit_cli (the plugin's own helper)
    session-start/orientation.sh       -- one `okfit context` call, builds additionalContext
    post-tool-use/validate.sh          -- bundle-scoped; context then validate
  bin/
    start-mcp.sh, start-lsp.sh         -- launchers on the pluginfinity server library
  builds/{claude,copilot}/             -- generated, committed, never edited
  __test__/
    lib/common.bash                    -- loads pluginfinity's bats helper; render, context_text, assert_stop
    lib/render-fixture.sh              -- __REPO_ROOT__ substitution
    fixtures/                          -- hook stdin envelopes, plus bundles/clean/ for the real-CLI smoke test
    manifest.bats, launchers.bats, session-start-orientation.bats,
    post-tool-use-validate.bats, agent-skill-registration.bats
```

The hook and launcher suites run against `builds/<target>/`, once per host,
so build before running them.

Kill switches: `OKFIT_HOOKS=off` disables both hooks; `OKFIT_SESSION_HOOK=off`
and `OKFIT_VALIDATE_HOOK=off` disable one each. Comparison is exact-string
`off` only — no `0`/`false` widening. `hooks/lib/okfit/okfit-cli.sh#okfit_cli`
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

`pluginfinity.config.ts` declares `SessionStart` orientation (no matcher)
and `PostToolUse` validate on `Write|Edit` — **not** `PreToolUse`:
`PreToolUse` fires before the edited file exists on disk, and `okfit
validate` has nothing to read at that point. The write has already landed by
the time `PostToolUse` fires, so a block from that hook is a stop-and-fix
signal, not a prevention. The hook keeps exactly two jobs (LSP phase 4,
decision 8): it blocks on a `core.conformance` diagnostic for the edited
file, and it reads the written file to block a `Write` (warn an `Edit`) of a
concept with no `generated.by` when the config sets `actors.agent`. Copilot
honours no `PostToolUse` block, so there `okfit_stop` sends the same reason
as `additionalContext`. It no longer emits `additionalContext` for
`core.lint` or profile diagnostics — the registered language server
delivers those with precise ranges.

Both hooks source the pluginfinity hook library first, read input only
through `hook_input`, take the project from `hook_project_dir`, and
`hook_cd_project` there before calling the CLI: `okfit context` resolves
the project from its working directory, and Copilot runs hooks from the
plugin root. Name tools and agents in skill and agent bodies with
`{{tool …}}` and `{{agent …}}` tokens, never a host spelling. Any
non-zero exit fails open and is logged under
`$XDG_STATE_HOME/pluginfinity/okfit/`; set `PLUGINFINITY_HOOK_DEBUG=1` to
log inputs while debugging.

The config registers `mcpServers.mcp`, running `bin/start-mcp.sh`, which
exposes the six tools named in `agents/okf-docs.md`'s `tools:` block
(`mcp__plugin_okfit_mcp__*` on Claude Code, `mcp/<tool>` on Copilot). It
also registers `lspServers.okfit`, running `bin/start-lsp.sh --stdio`
through `sh` for `.md`. Both launchers export `OKFIT_PROJECT_DIR` only when
`server_project_dir` reports a project; Copilot gives an MCP server none,
so there the server falls back to its working directory and the launcher
goes straight to `npx`. The install hint names `@okfit/plugin`
(`server_exec_bin … --install @okfit/plugin`), the package that ships the
bins; npx still runs the single-bin `@okfit/mcp` / `@okfit/lsp`.

Run the BATS suite with `pnpm test:bats` from the repo root, or one file
with `pnpm exec bats plugin/__test__/<file>`.

Never add `verified` entries to a concept from this plugin. `okfit verify`
exists and is a human-run CLI command; this plugin's agent and hooks never
invoke it and never write `verified` themselves.
