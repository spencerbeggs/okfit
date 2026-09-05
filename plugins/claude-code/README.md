# okfit Claude Code plugin

Teaches Claude Code the [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) v0.2 and keeps a repository's `okf/` bundle current.

## Local development

From the repository root:

```bash
pnpm claude
```

This starts Claude Code with `--plugin-dir plugins/claude-code`.

### Running the BATS suite locally

```bash
pnpm test:bats
```

This runs `bats --recursive plugins`, covering every `.bats` file under
`plugins/claude-code/__test__/`. `bats` is a root `devDependency`, so no
separate install is needed. `jq` must be on `PATH` for the tests that
exercise the real `jq` code path — the tests that simulate a missing `jq`
shim their own `PATH` for that one test, not the ambient one. One test, in
`__test__/post-tool-use-validate.bats` — the sole production-resolution
smoke test resolving the real `node_modules/.bin/okfit` binary against the
clean bundle fixture — `skip`s rather than fails when `OKFIT_BIN` is unset,
so running this suite never requires a build first.

To run a single suite:

```bash
pnpm exec bats plugins/claude-code/__test__/hooks-json.bats
```

## Skills

| Skill | Purpose |
| --- | --- |
| `okf-spec` | OKF v0.2 condensed reference: the conformance floor, the frontmatter field table by family, reserved files, the actor convention, and the v0.1-to-v0.2 changes. |
| `okf-authoring` | Sixteen imperative rules for writing and editing OKF concept files under a config: what is required, what to never touch, and the actor/timestamp conventions. |
| `okf-config` | The okfit config file: discovery order, the TOML schema table by table, lint severities, and what the `software-project` profile contributes. |
| `okf-context` | CLAUDE.md as a thin router into the bundle, checked against `index.md` — a pointer-coverage checklist. |
| `okf-finalize` | Branch-end sweep: reconcile touched concepts, run `okfit validate`, regenerate derived files, check CLAUDE.md pointer coverage, and report. |
| `npm-readme` | Writes or refreshes a package README: shape detection, section order, prose rules, and the badge block. |

Every skill is both user- and model-invocable (no `disable-model-invocation`)
and is preloaded, in full, by the `okf-docs` agent below.

## Agent

`agents/okf-docs.md` is the plugin's one agent. It keeps a repository's
`okf/` bundle and its CLAUDE.md pointer files current under the resolved
config's own type and tag vocabulary — never inventing one of its own. It
preloads all six skills above (`skills:`, not `Skill` in `tools:`, so their
full content is injected rather than merely discoverable). See its own
`## What this agent does NOT do` section for the boundary rather than a
restatement here: in short, it never touches `verified`, never edits
anything outside the bundle, CLAUDE.md files, and package READMEs, and never
commits, pushes, or writes a changeset.

## Hooks

**`SessionStart` — `hooks/session-start/orientation.sh`.** Runs on every
session source (`startup`, `resume`, `clear`, `compact` — no matcher, so all
four re-orient). It calls `okfit context --format json` once — never
`okfit validate`, which would load the whole bundle just to learn where it
is — and turns the result into `additionalContext`: the bundle root and
profile, the full type and tag vocabulary, the bundle's `index.md` contents
when one exists (truncated at 12,000 bytes), and a nudge to set
`actors.agent` when it is unset. With no project config at all it still
shows the `software-project` profile's default vocabulary, plus a note that
running `okfit init` would scaffold a config.

**`PostToolUse` — `hooks/post-tool-use/validate.sh`.** Runs after a `Write`
or `Edit` whose path falls under the bundle root. **The write has already
landed by the time this hook runs** — Claude Code only reports a completed
tool call to `PostToolUse` — so this hook is a stop-and-fix signal, not a
prevention: it runs `okfit validate --format json` scoped to the whole
bundle, filters the diagnostics down to the edited file, and turns any
`core.conformance` diagnostic for that file into
`{"decision": "block", "reason": "..."}`, which tells Claude to fix the file
immediately before continuing. A `core.lint` diagnostic for the file becomes
a non-blocking `additionalContext` warning instead. Diagnostics for every
other file are ignored, and a path outside the bundle root is never even
passed to `okfit validate`.

**Kill switches.** `OKFIT_HOOKS=off` disables both hooks; `OKFIT_SESSION_HOOK=off`
and `OKFIT_VALIDATE_HOOK=off` disable one each. `OKFIT_CLI_CMD` overrides
which `okfit` command a hook invokes — the BATS test suite's stubbing seam,
never needed in normal use. Absent that override, a hook resolves the CLI as
`<project>/node_modules/.bin/okfit`, then `okfit` on `PATH`; if neither
resolves, the session hook prints a one-line nudge to install
`@okfit/plugin` and the validate hook allows the write silently, writing one
line to stderr. Neither hook ever runs `npx`, and neither ever exits
non-zero — every decision travels in the JSON body, never in the exit code.
Both hook scripts are invoked as `bash "$path"` (see `hooks/hooks.json`),
not executed directly.

## MCP loader

`bin/start-mcp.sh` ships and is fully tested (`__test__/loader.bats`), but
`.claude-plugin/plugin.json` registers no `mcpServers` block yet.
`@okfit/mcp`'s current stub always exits `1`, so registering the loader now
would make every launch attempt fail identically whether `@okfit/mcp` is
simply not installed or installed-but-stubbed, with no way for a user to
tell the two apart. This lands once `@okfit/mcp` implements the MCP
protocol — phase 2.

## Status

Skills, the `okf-docs` agent, both hooks, and the MCP loader script are
implemented and tested; MCP server registration in the manifest is a
phase-2 follow-up.
