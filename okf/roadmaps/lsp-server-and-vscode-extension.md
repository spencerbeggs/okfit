---
type: Roadmap
title: An @okfit/lsp language server and a VS Code extension over the shared engine
description: "Seven phases that give agents and editors background diagnostics from the engine that already serves the CLI and MCP: a stdio language server first, registered through the Claude Code plugin, then a VS Code extension, then external-reference checks and an exploratory Effect-native transport."
status: stable
gate: "@okfit/lsp has shipped with diagnostics, navigation and status code actions; the Claude Code plugin registers it; the VS Code extension is published to the Marketplace and Open VSX; the okfit repository dogfoods both."
stale_after: 2026-12-21T00:00:00Z
tags:
  - architecture
  - dx
sources:
  - id: owner-brainstorm
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-09-22T00:00:00Z
  - id: owner-sequencing
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-09-23T00:00:00Z
  - id: claude-code-plugins-reference
    resource: https://code.claude.com/docs/en/plugins-reference.md
  - id: vscode-lsp-guide
    resource: https://code.visualstudio.com/api/language-extensions/language-server-extension-guide
  - id: vscode-1-100-notes
    resource: https://code.visualstudio.com/updates/v1_100
  - id: vscode-ux-guidelines
    resource: https://code.visualstudio.com/api/ux-guidelines/overview
  - id: vscode-multi-root
    resource: https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces
  - id: reactive-vscode
    resource: https://reactive-vscode.dev/
  - id: yaml-language-server
    resource: https://github.com/redhat-developer/yaml-language-server
generated:
  by: okfit/claude-code
  at: 2026-09-23T21:50:18Z
  body_sha256: d8f9c54f3830555d5b2db877681ba36ac16f506cbe6be99f2889080be1b836c7
verified:
  - by: human:spencer
    at: 2026-09-22T20:19:51Z
---

# An @okfit/lsp language server and a VS Code extension over the shared engine

## Gate

The roadmap closes when `@okfit/lsp` has shipped with diagnostics,
navigation and status code actions, the Claude Code plugin registers it
so agents receive diagnostics after every edit without a hook running,
the VS Code extension is published to the Marketplace and Open VSX, and
this repository dogfoods both on its own bundle. The phases were agreed
with the repository owner on 2026-09-22[^owner-brainstorm]; the full
design lives in the local, gitignored spec
`docs/superpowers/specs/2026-09-22-okfit-lsp-and-vscode-design.md`.

## Shape

Two new workspace packages join [Engine](../modules/engine.md),
[CLI](../modules/cli.md), [MCP](../modules/mcp.md),
[Plugin](../modules/plugin.md) and the
[Claude Code Plugin](../modules/claude-code-plugin.md):

- `packages/lsp` publishes `@okfit/lsp`, the `okfit-lsp` bin, a Language
  Server Protocol server over stdio built on the reference
  `vscode-languageserver` library with an Effect program behind every
  handler. The library sits behind a small transport seam so an
  Effect-native transport can replace it later without touching a
  feature. Standalone stdio is what lets one server serve Claude Code,
  VS Code, Neovim and Zed alike[^vscode-lsp-guide]; the
  yaml-language-server and its separate vscode-yaml extension are the
  precedent for the split[^yaml-language-server]. Shipped in phase 3
  with diagnostics only.
- `plugins/vscode` is a private, tag-only workspace package like the
  Claude Code plugin: reactive-vscode 1.x, one ES-module entry (desktop
  hosts load ESM since VS Code 1.100; the web host is still
  CommonJS-only, so there is no web build)[^vscode-1-100-notes],
  published from a tag to the Marketplace and Open VSX, never to npm.

The engine gains the seams both consumers need: an overlay `FileSystem`
layer that serves open editor buffers over disk without touching core; a
`BundleSession` service holding one loaded bundle per bundle root with a
whole-bundle revalidate that diffs diagnostics per file (the language
server owns the debounce), including files not open; an
`ExternalReferences` reachability service,
no-op at first; and unsaved-document inputs for `okfit validate` and the
MCP `validate_bundle` tool, so the CLI and MCP keep parity with the
editor.

Agents are the first consumer. Claude Code pushes a registered server's
diagnostics into the model's context after each edit and exposes hover,
definition, references and symbols through its built-in tool, but not
code actions or execute-command[^claude-code-plugins-reference], so
status changes for agents stay on the CLI and MCP while the click-to-
change-status feature belongs to the extension. The server registers for
`.md` and answers only for files under a discovered bundle root; one
server per extension starts in Claude Code, first registered wins, which
the plugin README states rather than solves.

The extension follows the VS Code UX guidelines: one view in the
Explorer rather than a custom Activity Bar container, a Language Status
item rather than a status-bar error count that would duplicate the
Problems counter, inlay hints from the server rather than client-side
decorations, no notifications for routine feedback, theme colours and
codicons only[^vscode-ux-guidelines]. It supports multi-root workspaces:
one language client per window, one bundle session per resolved bundle
root shared across every workspace folder that resolves to it, config
discovered per folder, folders added and removed through the LSP
workspace-folders notifications, and a resource-scoped server-path
setting[^vscode-multi-root]. reactive-vscode has no language-client
composable, so the client is wired by hand and disposed through the
reactive API[^reactive-vscode]. Phase 6 was sequenced before phase 5 on
2026-09-23, by the owner's decision[^owner-sequencing], so the extension's
first release shipped without Set Status, Mark Verified or inlay hints,
picking them up once phase 5 landed the same day; the
extension's tracking package lives at `vscode/`, sibling to `packages/*`
and `plugins/claude-code`, not under either -- see [The VS Code extension
lives at vscode/, not under plugins/ or
packages/](../decisions/vscode-extension-at-repo-root.md).

## Phases

Each phase is one PR and one release, ending with a dogfood check on this
repository's own bundle.

1. **Claude Code probe** (throwaway). A toy plugin settles whether the
   plugin-root variable expands inside `lspServers`, whether a shell
   wrapper is accepted as the command, and whether diagnostics pushed
   for files other than the edited one reach the model. The answers fix
   the shim design and the cross-file publishing strategy. Done
   2026-09-22: root expansion held, a `sh` wrapper was
   accepted, cross-file diagnostics reach the
   model, and the `diagnostics` key loads; phase 3
   uses the section 6.1 manifest and
   per-file publishing.
   Remaining: nothing.
2. **Engine seams.** Overlay filesystem layer, `BundleSession`,
   `ExternalReferences` with only its no-op layer, the rule that a
   diagnostic without a range maps to the concept's frontmatter block
   rather than line zero, and the unsaved-document inputs for CLI and
   MCP. Releases engine, cli, mcp. Remaining: nothing (released
   2026-09-22 in engine 0.7.5, cli 0.6.5, mcp 0.5.2).
3. **Server, diagnostics only.** `packages/lsp` with the transport
   seam, the reference implementation, document sync, push diagnostics,
   a test that nothing under `src/` writes to stdout (Claude Code counts
   a stray line as a crash), in-process protocol contract tests and one
   child-process smoke test. The Claude Code plugin gains its
   `lspServers` entry and a `bin/start-lsp.sh` shim shaped like the MCP
   loader; the meta-package gains its third bin. A notes concept on the
   Effect-native transport starts here. Done 2026-09-23: shipped
   diagnostics-only, and dogfooded on this repository under Claude Code
   2.1.280 with `--plugin-dir plugins/claude-code`: the debug log shows
   `Loaded 1 LSP server(s) from plugin: okfit` and `LSP server instance
   started: plugin:okfit:okfit`, and an Edit appending a broken link to
   `okf/modules/lsp.md` produced a diagnostics attachment naming
   `broken-links` for that file; the second Edit, which removed the line,
   produced no attachment, and the file was restored (`okf/` clean).
   The run left the PostToolUse validate hook's context output on rather
   than disabled; the language server's attachment was reported
   separately from the hook's, so the two were distinguishable in the
   evidence. Remaining: the release.
4. **Precise ranges and navigation.** First, config reload: on a
   config change, rebuild the affected bundle root's session and
   schedule a full revalidate; publish `[]` for every URI a dropped
   session last published non-empty; carry open overlays into the
   rebuilt session
   ([the phase 3 limitation](../limitations/no-config-reload-in-phase-3.md)).
   This is a prerequisite for phase 6, since VS Code sends the
   watched-file and workspace-folder notifications. Then every lint rule that knows its
   field or link attaches a range through the mapper core already owns
   (most rules attach none today, which the CLI and MCP tolerate and an
   editor does not). Hover, document links, definition, references,
   workspace symbols. The PostToolUse validate hook shrinks to its
   block-only role on conformance errors plus the Write-time
   `generated.by` check, since the server now delivers lint and profile
   findings with ranges. Releases core, profiles, lsp, the Claude Code
   plugin. Done 2026-09-23: every core lint rule that knows its field
   anchors its diagnostic at the offending value, profiles' and engine's
   drift, project and resource diagnostics anchor the same way, config
   reload rebuilds a bundle root's session (shared, reference-counted,
   across every workspace folder resolving to it) and clears a dropped
   session's diagnostics, the scheduler's debounce carries a `maxWait` ceiling,
   hover, document links, definition, references and workspace symbols
   answer from the loaded bundle, and the PostToolUse hook keeps only
   the conformance block and the `generated.by` check. Evidence: 1016
   of 1016 Vitest tests and 97 of 97 BATS cases passing, zero API
   Extractor warnings across all seven built packages, and the reviewed
   commits `6b4ac1d`, `78bf22e`, `f4f6494`, `bee2f21`, `225c942`,
   `37117e0`, `f227b7e`, `288dc1f`, `fa24671`, `10ac546`, `9d1f4e5`,
   `eff1e78`, `5168176`. Remaining: the Claude Code dogfood check and
   the release.
5. **Actions.** Code actions for status (draft, stable, deprecated) and
   for marking verified by the configured human actor, computed as text
   edits over the verify splice helpers so a file is never
   re-serialised; mechanical quick fixes; execute-command; inlay hints
   after the `status:` or `type:` line and `generated.at`'s age. Releases
   engine, lsp. Done 2026-09-23: `@okfit/engine` gained the
   `FrontmatterEdits` public facade (`status`/`verified`) over the
   `verify/locate.ts`/`verify/splice.ts` machinery, superseding the
   CLI-private splice decision -- see [Frontmatter splices are a shared
   engine surface for the CLI's verify and the language server's
   actions](../decisions/engine-frontmatter-edits-shared-surface.md).
   `@okfit/lsp` gained `textDocument/codeAction` (Set status, Mark
   verified, `status-missing` quick fixes), `workspace/executeCommand`
   (`okfit.setStatus`, `okfit.markVerified`, `okfit.revalidate`, edits
   applied through `workspace/applyEdit`, never written to disk), and
   `textDocument/inlayHint`. Evidence: `@okfit/engine` 291 of 291 Vitest
   tests passing (6 new for `FrontmatterEdits`), `@okfit/lsp` 173 of 173
   Vitest tests passing (task reports along the way recorded 141, 150,
   158, 161 and 171 as each feature landed); the extension's Set Status
   and Mark Verified commands (phase 6, below) shipped on top of this
   phase the same day. Remaining: nothing; the owner's own VS Code UI
   pass (below) is still owed.
6. **VS Code extension.** The `vscode/` workspace member (tracking
   package `@okfit/vscode-extension`, Marketplace id `okfit`, publisher
   `okfit`), a `reactive-vscode` language client with per-folder server
   resolution (`okfit.lsp.serverPath`, then a workspace folder's own
   `node_modules/.bin/okfit-lsp`, then the bundled server, all launched
   over stdio), the OKF Concepts explorer tree with status and stale
   badges, a Language Status item, the Validate Bundle and Open Concept
   commands, multi-root support, and the `VS Code Marketplace` GitHub
   Actions workflow (Marketplace and Open VSX, federation-first with a
   PAT fallback). Done 2026-09-23, joined the same day by the Set Status
   and Mark Verified commands and inline tree actions phase 5 unblocked,
   and by the `vscode:package`/`vscode:install` root scripts for a
   local-install check. Evidence: `@okfit/vscode-extension` 63 of 63
   Vitest tests passing. Remaining: the Marketplace publisher
   registration, the icon asset, the federation credentials, the first
   release, and the owner's own VS Code UI pass -- lightbulb on a
   concept's frontmatter to confirm the code actions render; Set status
   through both the lightbulb and the OKF Concepts tree's inline/context-
   menu action; Mark verified by `human:spencer` appearing and applying;
   inlay hints showing after `status:`/`type:` and `generated.at`; the
   quick fix on a status-less concept; and Validate Bundle re-publishing
   after an edit made in another editor outside VS Code.
7. **External references for real.** An HTTP-backed
   `ExternalReferences` layer over `@effected/store`'s TTL `Cache` in
   the XDG cache directory, an `external-unreachable` lint that core
   evaluates from a result map passed in the way `now` is, switched on
   behind config, lazy background checks in the session, and an opt-in
   `okfit validate --external`. Releases engine, core, lsp. Remaining:
   everything.
8. **Effect-native transport** (exploratory). A Content-Length framed
   `RpcSerialization` over Effect's stdio RPC protocol with LSP methods
   as an `RpcGroup`, run against the phase 3 contract tests. Effect's
   own MCP server already maps JSON-RPC method names onto RPC tags with
   pluggable framing, so the estimate is one to two weeks for the
   subset used here. Its home is decided by the outcome: an
   `@effected/lsp` package if generic, an upstream proposal if the
   Effect team wants it. Remaining: everything.

Deferred and named as such: completion of link targets and type names,
semantic tokens, a web extension build, incremental per-file validation
(which waits for a measurement showing whole-bundle revalidate, about
half a second on this bundle at the cheap tier, is too slow), and general
markdown linting through okfit. That last one needs a lint-rule engine in
`@effected/markdown` first, which has the parser, visitor, diagnostic and
edit surfaces but no rule engine yet, unlike `@effected/yaml`; until
then markdownlint-cli2 keeps its job unchanged, since it is a command
rather than a language server and never competes for the `.md` slot.

[^owner-brainstorm]: conversation with the repository owner
[^owner-sequencing]: conversation with the repository owner
[^claude-code-plugins-reference]: <https://code.claude.com/docs/en/plugins-reference.md>
[^vscode-lsp-guide]: <https://code.visualstudio.com/api/language-extensions/language-server-extension-guide>
[^vscode-1-100-notes]: <https://code.visualstudio.com/updates/v1_100>
[^vscode-ux-guidelines]: <https://code.visualstudio.com/api/ux-guidelines/overview>
[^vscode-multi-root]: <https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces>
[^reactive-vscode]: <https://reactive-vscode.dev/>
[^yaml-language-server]: <https://github.com/redhat-developer/yaml-language-server>
