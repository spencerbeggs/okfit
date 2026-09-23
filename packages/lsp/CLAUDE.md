# @okfit/lsp

The `okfit-lsp` bin: an LSP server over stdio that publishes engine
diagnostics for a discovered bundle in any LSP client, Claude Code
included; the server writes nothing, ever, to the bundle.

## Layout

```text
src/
  version.ts     -- LSP_VERSION, read from process.env.__PACKAGE_VERSION__, a
                     build-time constant the bundler injects -- never a
                     package.json import
  errors.ts      -- LspError: the one failure a request handler may return
  index.ts       -- public barrel; this is what later tasks and tests import
  convert/
    uri.ts         -- uriToPath, pathToUri: file: URI <-> absolute path,
                      percent-encoded, None for a non-file or malformed URI
    diagnostic.ts  -- SEVERITY, toLspDiagnostic: RenderedDiagnostic (engine) ->
                      LSP Diagnostic; sourceTextOf: a bundle concept's source text
  protocol/
    LspTransport.ts -- the seam: LspTransportShape, ListenOutcome, the
                       LspTransport service tag
    reference.ts    -- makeReferenceTransport: the seam over
                       vscode-languageserver
    types.ts        -- type-only re-exports of the protocol types
                       (InitializeParams, LspDiagnostic, Did*Params, ...)
  session/
    scheduler.ts    -- makeScheduler: the debounced revalidate trigger.
                       Scheduler { schedule, settle }; schedule coalesces a
                       burst behind a fixed delay and never downgrades a
                       tier to "edit" once "full" is requested; a schedule
                       during a run queues exactly one more run
    registry.ts     -- makeSessionRegistry: workspace folders -> one
                       BundleSession per bundle root, lazily, with config
                       discovery per folder; SessionHandle bundles a
                       folder's session and scheduler
```

The Layout tree above is a map, not a substitute for reading source: it
names files and their headline exports, not every symbol. Later tasks
extend this tree; read the file before assuming its export list from this
tree alone.

Tests live in `__test__/`, never in `src/`; see `__test__/CLAUDE.md`.

## The transport seam

Features code against `LspTransportShape` (`src/protocol/LspTransport.ts`),
never the library. Its eight members:

- `onInitialize`, `onInitialized`, `onShutdown` -- the lifecycle hooks.
- `onRequest(method, handler)` -- an `LspError` failure is answered as a
  JSON-RPC error with the error's `code` and `message`; a defect as `-32603`.
- `onNotification(method, handler)` -- a defect is reported to the client
  as a `window/logMessage` error, never to stdout.
- `sendNotification` -- a send on a closed connection is dropped.
- `sendRequest` -- a JSON-RPC error answer fails with an `LspError`.
- `listen` -- starts reading and resolves with a `ListenOutcome` when the
  connection ends. Call once.

`ListenOutcome.reason` is `"exit"` (the client sent `exit`) or `"closed"`
(the input stream ended first); `shutdownReceived` says whether `shutdown`
came before. A transport never exits the process: the caller maps the
outcome to an exit code. Registration is not order-sensitive; a handler
registered after `listen` still answers.

The reference transport, given `streams`, builds the connection on the
library's server core (`createConnection(factory, watchDog, features)` from
the root entry) with its own watchdog, because the library's node entry
calls `process.exit` after any `onExit` handler and on raw-stream
`end`/`close`. Without `streams` it falls back to the node entry's argv
handling and that exit behaviour; `main.ts` passes `process.stdin` and
`process.stdout` as `streams`.

A future Effect-native transport is done when
`__test__/protocol/reference.test.ts` passes unchanged against it.

## Rules

- No file under `src/` reads `process` except `bin.ts`, `main.ts` and
  `version.ts` -- `version.ts`'s `process.env.__PACKAGE_VERSION__` is not a
  runtime read at all: the bundler replaces it with a string literal at
  build time (K-32).
- No file under `src/` writes to stdout: no `process.stdout`, no
  `console.log`/`info`/`debug`/`table`.
- Only `src/protocol/reference.ts`, `src/main.ts` and the type-only
  `src/protocol/types.ts` (created in Task 2) may import from
  `vscode-languageserver*`. A feature imports the seam
  (`../protocol/LspTransport.js`) and the engine, never the library
  directly; a feature that needs a protocol method it does not have adds
  it to the seam first.
- `now` is read once per revalidate at the server boundary (`DateTime.now`)
  and passed into the engine; nothing in the engine reads a `Clock`.
- Effect v4 only, at the version in `catalog:effect`. Consult
  `.repos/effect/packages/effect/src` for what v4 exports; `node_modules`
  wins on disagreement.
- Relative imports use `.js` extensions; built-ins use `node:`. Type
  imports are separate `import type` statements. TSDoc `@public` on every
  `src/` export. Tab indentation.
- Commits are conventional, DCO signed, and never on `main`.
