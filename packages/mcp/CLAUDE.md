# @okfit/mcp

The `okfit-mcp` bin: an MCP server over stdio, built on `@effected/mcp`'s
`McpStdio`/`McpToolkit` (themselves built on `effect/unstable/ai`'s
`McpServer`), exposing six read-only tools and the bundle index plus one
resource per concept against an OKF bundle. The server writes nothing,
ever, to the bundle, the config, or anywhere else — `validate_bundle` now
spawns read-only `git log`/`git show` for one lint, but a read is not a
write, and that promise stands (S-16). See [okfit's front ends build on
@effected/{engine,cli,mcp} rather than hand-rolled
equivalents](../../okf/decisions/front-ends-adopt-the-effected-kit.md)
for what moved from a hand-rolled equivalent to the kit.

## Layout

```text
src/
  bin.ts                       -- the shebang entry point: imports and awaits main()
  main.ts                      -- crash guards, OkfitPlatform (@okfit/engine),
                                   McpStdio.launch/.teardown (@effected/mcp)
  index.ts                     -- programmatic barrel (ServerLayer, schemas, errors)
  version.ts                   -- MCP_VERSION, read from process.env.__PACKAGE_VERSION__, a
                                   build-time constant the bundler injects -- never a
                                   package.json import, which would report engine's version
                                   for anything that moved there. It is what `initialize`
                                   reports; validate_bundle's envelope names the engine as
                                   engine_version and the launching meta-package as
                                   distribution (okf/decisions/engine-version-is-the-comparable-version-effected-kit.md)
  server.ts                    -- ServerLayer: McpToolkit.layer + resource layers over
                                   McpStdio.layer (both @effected/mcp)
  toolkit.ts                   -- OkfitToolkit = Toolkit.make(...six tools); handler wiring
  errors.ts                    -- McpToolError union, five members, built on @effected/mcp's
                                   ToolFailure and @effected/engine's Remediation
  schema/
    ConceptSummary.ts          -- the one shared concept summary schema
    tools.ts                   -- per-tool Parameters/Success structs
  tools/
    describeVocabulary.ts      -- Tool.make + handler, one file per tool
    listConcepts.ts
    getConcept.ts
    conceptNeighbors.ts
    staleReport.ts
    validateBundle.ts
  resources/
    conceptResource.ts         -- okf://concept/<id>, one static resource per concept at boot
    indexResource.ts           -- okf://index, re-read from disk on every call
  internal/
    projectRoot.ts             -- resolveMcpProjectRoot(env, cwd): @effected/engine's
                                   LaunchContext.projectDir over the env precedence, called
                                   once from main.ts with process.env/process.cwd()
    toolContext.ts             -- loadToolContext: config + bundle per call
    resolveNow.ts              -- optional ISO `now` argument else the Effect clock
```

One responsibility per file. `toolkit.ts` is the single place a tool's
`Tool.make` value and its handler meet, so a structural test can import the
served toolkit with no bin or platform dependency. `main.ts` is the only
place `process.env`/`process.cwd()` are read in this package --
`internal/projectRoot.ts` takes both as plain arguments so it stays pure
and testable; `version.ts` also reads `process.env.__PACKAGE_VERSION__`,
but that is a build-time constant `@savvy-web/bundler` replaces at compile
time, not a runtime environment read, the same distinction `@okfit/cli`'s
boundary-test allowlist comment draws for its own copy of that pattern.
This package has no boundary test of its own (no scanner, no
`boundaries.test.ts` under `packages/mcp/__test__`), so this rule lives
only in prose here and nothing enforces it. **The server writes nothing,
ever** — every tool and resource only reads the bundle and the config.

## Resources are static, not templated

`resources/conceptResource.ts` registers one literal `okf://concept/<id>`
resource per concept **loaded once when the server starts**, plus
`okf://index`. This amends the original template design: a URI template's
parametric segment cannot span the `/` every nested concept id contains, so
each concept gets its own fixed URI instead. Editing an already-listed
concept's file is picked up live, since `content` re-reads it from disk on
every call; a concept added or removed after boot is not reflected in
`resources/list` until the server restarts. There is no completion, since a
fixed list needs none.

## Errors reach the wire as `isError`

Every tool declares the whole `McpToolError` union as its failure schema.
Under `McpServer`'s `failureMode: "error"` (the only mode this server
uses), a declared failure collapses to
`{ isError: true, content: [{ type: "text", text: error.message }] }` —
`structuredContent` is never populated for a failure, and (since
effect@4.0.0-rc.116) no log line is emitted for it either — only an
internal failure is logged. Each error class spreads `@effected/mcp`'s
`ToolFailure.fields` (`{ message, remediation }`) instead of declaring
those two fields by hand; the tool file constructing an error builds
`message` with `ToolFailure.message(raw, remediation)` and truncates any
caller-supplied value first with `ToolFailure.truncate(value)`, so the
remediation hint reaches the client inside that one text field rather
than as a separate structured field.

## Strict input, every unknown key named at once

`server.ts` registers the toolkit through `@effected/mcp`'s
`McpToolkit.layer`, not core's own `McpServer.toolkit` directly. Every
served tool's `inputSchema` is closed (`additionalProperties: false` at
every object node), and a call carrying an argument the schema does not
accept fails with one `InvalidParams` naming every unknown key at every
depth, plus the accepted params at that level — not just the first excess
key core's own `registerToolkit` would report on its own. `McpStdio.layer`
(the kit's replacement for hand-wiring `McpServer.layerStdio`) additionally
guards stdin: a line that is not JSON gets a JSON-RPC `-32700` reply and
the server keeps serving, and JSON that is not a JSON-RPC message (`null`,
a bare scalar, an object with neither `method` nor `id`) gets `-32600` and
the server keeps serving too. See [okfit's front ends build on
@effected/{engine,cli,mcp} rather than hand-rolled
equivalents](../../okf/decisions/front-ends-adopt-the-effected-kit.md).

## Three protocol adapters, stateless first

`server.ts` declares `[McpProtocol.v2026_07_28, McpProtocol.v2025_11_25,
McpProtocol.v2025_06_18]` and exports `SERVER_INSTRUCTIONS`, surfaced in
both the `initialize` and `server/discover` results. `2026-07-28` is the
stateless adapter (no `initialize`, `_meta`-routed requests); the stateful
two stay because `initialize` only matches stateful adapters. Claude Code
opens with `initialize` by default and with `server/discover` under
`MCP_PROTOCOL_NEGOTIATION=auto`. See
`okf/decisions/mcp-stateless-first-protocol-list.md` for the rationale and
`__test__/protocol.test.ts` for the
revision × outcome matrix (invalid params is a JSON-RPC `-32602` on
`2025-06-18` and an `isError` result on the other two — the runtime's own
split, not a bug).

## Two test tiers

Classified by filename suffix, as the root `vitest.config.ts` already does:

- `.test.ts` — in-process against `Stdio.layerTest`, no child process;
  `__test__/utils/harness.ts` wraps `@effected/mcp/testing`'s
  `McpHarness` rather than hand-porting the request/response plumbing.
- `.e2e.test.ts` — spawns the real built bin,
  `dist/dev/pkg/bin/okfit-mcp.js`, through `@effected/mcp/testing`'s
  `McpProcess` (`McpProcess.spawn`/`.readUntilResponse`), which replaced
  this package's own hand-rolled queue/stream reader
  (`__test__/e2e/utils/mcpProcess.ts`, deleted).

## Project root resolution

`internal/projectRoot.ts#resolveMcpProjectRoot` resolves once, at bin
startup: `OKFIT_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → `cwd`. Built on
`@effected/engine`'s `LaunchContext.projectDir` with an empty `argv` (this
server has no command parser); the plugin's `start-mcp.sh` loader forwards
`"$@"` with nothing in it. `LaunchContext.projectDir` also treats a value
still carrying a literal, unexpanded `${VAR}` placeholder as unusable --
protection the previous hand-rolled `??` chain did not have, against a
launch path that leaves `CLAUDE_PROJECT_DIR` unexpanded.

Tests live in `__test__/`, never in `src/`.
