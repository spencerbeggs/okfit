# @okfit/lsp

The `okfit-lsp` bin: an LSP server over stdio that publishes engine
diagnostics for a discovered bundle in any LSP client, Claude Code
included; the server writes nothing, ever, to the bundle.

## Layout

```text
src/
  bin.ts         -- the shebang entry point: imports and awaits main()
  main.ts        -- crash guards, OkfitPlatform + Git.layer + GitHistory.layer,
                     runMain; the process boundary -- owns process.stdin/stdout
                     and the exit code
  version.ts     -- LSP_VERSION, read from process.env.__PACKAGE_VERSION__, a
                     build-time constant the bundler injects -- never a
                     package.json import
  errors.ts      -- LspError: the one failure a request handler may return
  index.ts       -- public barrel; this is what later tasks and tests import
  server.ts      -- serve(transport, options): wires initialize (folders,
                     capabilities, serverInfo), initialized (one log line),
                     workspace folder and watched-file notifications,
                     document sync and diagnostics onto the transport, then
                     listens; ServeOptions { delay, distribution }, ServeServices
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
  features/
    documentSync.ts -- DocumentEvent, registerDocumentSync: the four
                       textDocument/did* notifications as events on
                       absolute paths; non-file URIs dropped
    diagnostics.ts  -- makeDiagnosticsFeature: DiagnosticsFeature
                       { onDocumentEvent, onWatchedFiles,
                       revalidateAndPublish }, the overlay updates, tier
                       choice and publishDiagnostics fan-out
```

The Layout tree above is a map, not a substitute for reading source: it
names files and their headline exports, not every symbol. Later tasks
extend this tree; read the file before assuming its export list from this
tree alone.

Tests live in `__test__/`, never in `src/`; see `__test__/CLAUDE.md`.

## Publishing rules

- Tier per event: `didOpen` and `didSave` schedule the `full` tier;
  `didChange` and `didClose` the `edit` tier. A watched-file change
  schedules `full` on every live session, except a config discovery file,
  which invalidates that folder's session instead.
- One `textDocument/publishDiagnostics` per file in the engine's
  `changed` map, and nothing else: a file whose set did not change is not
  republished, a file whose set became empty publishes `[]`, and a file
  that is not open publishes like one that is (a cross-file break).
- A bundle-level diagnostic (engine file `""`, for example
  software-project's `project-missing`) publishes against the bundle
  root's `index.md`.
- A revalidate that fails logs one warning naming the bundle root and
  publishes nothing.
- A non-`file:` URI (`untitled:`, ...) is ignored. So is a document outside
  every bundle root (a workspace folder's `README.md`, or any file while no
  folder is open); a folder added later serves the next event for it.
- Notification work runs on one queue drained by a single fiber, in the
  order the client sent it; the transport itself runs every handler on its
  own fiber, so without the queue a `didChange` could overtake the
  `didOpen` before it. `shutdown` drains that queue up to its own arrival,
  then waits for every scheduler to settle, so work sent before it is
  published before the response.

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

## The process boundary: `bin.ts` and `main.ts`

`bin.ts` is the shebang entry point, nothing else: imports and awaits
`main()`. `main.ts` mirrors `packages/mcp/src/main.ts`'s crash-guard
prologue (`uncaughtException`/`unhandledRejection` installed before any
dynamic import, so a throw during module evaluation still reaches stderr)
and owns everything the package boundary test allows it to: it is the one
file, besides `bin.ts` and `version.ts`'s build-time constant, that reads
`process`.

- **`streams` are mandatory, not optional.** `main.ts` always calls
  `makeReferenceTransport({ streams: { input: process.stdin, output:
  process.stdout } })`. Omitting `streams` falls back to the library's own
  node-entry argv handling, whose `finally` calls `process.exit` itself
  before `listen` ever resolves -- `main.ts` would never get a
  `ListenOutcome` to map to an exit code. `--stdio` on the command line is
  therefore accepted and silently ignored (never read); `--node-ipc`,
  `--socket` and `--pipe`, which only make sense for the library's own argv
  path, are not supported at all.
- **Exit code.** `1` only when the outcome is `reason: "exit"` with
  `shutdownReceived: false`; every other outcome -- `shutdown` then `exit`,
  or the input stream simply closing -- exits `0`. `shutdownReceived` is
  the authority: an `exit` that races the stream's own end may report
  `"closed"` instead of `"exit"`, which harmlessly still maps to `0`.
- **`process.exit` is called directly in `main.ts`'s `teardown`, not
  through the `onExit` callback `NodeRuntime.runMain`'s own runner hands
  in.** That callback (`@effect/platform-node-shared`'s `NodeRuntime.js`)
  only calls `process.exit` itself when the code is non-zero or a signal
  was received; for a code-`0` success it relies on Node's event loop
  draining naturally. `process.stdin`, once read, keeps the loop alive on
  its own -- so a clean `shutdown` + `exit` sequence with stdin still open
  (the LSP spec's own contract: the server terminates itself on `exit`,
  the client is never required to close the pipe first) would otherwise
  hang the process forever at code `0`. Reproduced directly against the
  built bin before this fix; `main.ts`'s `teardown` now calls
  `process.exit` unconditionally for both the success and the
  interrupts-only branches instead of delegating to `onExit`.
- `Logger.layer([Logger.consolePretty()])` and `Layer.succeed(Logger.LogToStderr,
  true)` are both provided in `main.ts`, exactly as `packages/mcp/src/main.ts`
  does -- without the second, every log line (`serve`'s `Effect.logInfo` on
  `initialized`, `Effect.logWarning` on a failed revalidate) lands on
  stdout, the JSON-RPC wire, instead of stderr.

## Three test tiers

Classified by filename suffix, as the root `vitest.config.ts` already does:

- `.test.ts` -- in-process against a harness built on `makeReferenceTransport`
  over in-memory streams (`__test__/utils/harness.ts`), no child process.
- `.e2e.test.ts` (`__test__/e2e/`) -- spawns the real built bin,
  `dist/dev/pkg/bin/okfit-lsp.js`, with `--stdio`, framed on
  `Content-Length` (`__test__/e2e/utils/lspProcess.ts`), against a
  hermetic sandbox with the fixture project copied into `cwd`
  (`__test__/e2e/utils/sandbox.ts`). Uses `it.live`, not `it.effect`: the
  exit-code assertions time out against real elapsed time, not the virtual
  clock.
- `.bats` -- the plugin's shell scripts, not this package.

## Rules

- No file under `src/` reads `process` except `bin.ts`, `main.ts` and
  `version.ts` -- `version.ts`'s `process.env.__PACKAGE_VERSION__` is not a
  runtime read at all: the bundler replaces it with a string literal at
  build time (K-32).
- No file under `src/` writes to stdout: no `console.log`/`info`/`debug`/`table`
  anywhere, and no call to `.write` on `process.stdout` outside `main.ts`,
  which only ever passes the stream object itself to `makeReferenceTransport`
  as `streams.output` -- the transport, not `main.ts`, ever writes to it.
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
