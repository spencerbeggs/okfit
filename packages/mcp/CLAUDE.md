# @okfit/mcp

The `okfit-mcp` bin: an MCP server over stdio (`effect/unstable/ai`'s
`McpServer`) exposing six read-only tools and the bundle index plus one
resource per concept against an OKF bundle. The server writes nothing,
ever, to the bundle, the config, or anywhere else.

## Layout

```text
src/
  bin.ts                       -- crash guards, PlatformLayer, runMain
  index.ts                     -- programmatic barrel (ServerLayer, schemas, errors)
  version.ts                   -- MCP_VERSION, read from this package's own package.json
  server.ts                    -- ServerLayer: toolkit + resource layers over layerStdio
  toolkit.ts                   -- OkfitToolkit = Toolkit.make(...six tools); handler wiring
  errors.ts                    -- McpToolError union, five members, composeRemediatedMessage
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
    projectRoot.ts             -- resolveMcpProjectRoot (env precedence)
    toolContext.ts             -- loadToolContext: config + bundle per call
    resolveNow.ts              -- optional ISO `now` argument else the Effect clock
```

One responsibility per file. `toolkit.ts` is the single place a tool's
`Tool.make` value and its handler meet, so a structural test can import the
served toolkit with no bin or platform dependency. `internal/` is the only
place `process.env` is read outside `bin.ts`. **The server writes nothing,
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
`structuredContent` is never populated for a failure. `errors.ts`'s
`composeRemediatedMessage` folds each error's remediation hint into
`message` at construction, so the hint reaches the client inside that one
text field rather than as a separate structured field.

## Two test tiers

Classified by filename suffix, as the root `vitest.config.ts` already does:

- `.test.ts` — in-process against `Stdio.layerTest`, no child process.
- `.e2e.test.ts` — spawns the real built bin,
  `dist/dev/pkg/bin/okfit-mcp.js`.

## Project root resolution

`internal/projectRoot.ts#resolveMcpProjectRoot` resolves once, at bin
startup: `OKFIT_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → `process.cwd()`. No
argv flags are read; the plugin's `start-mcp.sh` loader forwards `"$@"`
with nothing in it.

Tests live in `__test__/`, never in `src/`.
