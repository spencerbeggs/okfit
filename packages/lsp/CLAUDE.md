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
  index.ts       -- public barrel for embedders: the transport seam, serve,
                     the registry, the register* features, the diagnostics
                     publisher and feature, SYMBOL_KIND_OBJECT and the
                     convert helpers; implementation helpers (locate.ts,
                     renderHover, documents.ts) are @internal and tests
                     import them from their src/ paths
  internal/
    messageOf.ts   -- messageOf: the error's `message` when it has one as a
                      string, else `String(error)`; shared by
                      features/diagnostics.ts and session/registry.ts,
                      @internal, not in the barrel
    paths.ts       -- isUnder(root, path): whether path is root itself or
                      under it; shared by session/documents.ts and
                      session/registry.ts, @internal, not in the barrel
  server.ts      -- serve(transport, options): wires initialize (folders,
                     capabilities, serverInfo), initialized (one log line),
                     workspace folder and watched-file notifications,
                     document sync and diagnostics onto the transport, then
                     listens; ServeOptions { delay, maxWait, distribution },
                     ServeServices
  convert/
    uri.ts         -- uriToPath, pathToUri: file: URI <-> absolute path,
                      percent-encoded, None for a non-file or malformed URI
    diagnostic.ts  -- SEVERITY, toLspDiagnostic: RenderedDiagnostic (engine) ->
                      LSP Diagnostic; sourceTextOf: a bundle concept's source text
    range.ts       -- toLspRange, toLspLocation: DiagnosticRange (core) -> LSP
                      Range/Location, end position re-mapped through the file
                      text the same way toLspDiagnostic's does
  protocol/
    LspTransport.ts -- the seam: LspTransportShape, ListenOutcome, the
                       LspTransport service tag
    reference.ts    -- makeReferenceTransport: the seam over
                       vscode-languageserver
    types.ts        -- type-only re-exports of the protocol types
                       (InitializeParams, LspDiagnostic, Did*Params,
                       DocumentLink*, DefinitionParams, ReferenceParams,
                       Location, Range, Position, Hover*, MarkupContent,
                       WorkspaceSymbol*, SymbolInformation, ...) plus the
                       numeric constant SYMBOL_KIND_OBJECT (19, SymbolKind.Object)
  session/
    documents.ts    -- DocumentMemoryShape, makeDocumentMemory (@internal,
                       not in the barrel): a
                       registry-wide Ref<Map<absolutePath, {text, version}>>
                       of open documents, keyed by absolute path (ownership
                       shifts with the workspace folder set, so this is not
                       per-folder); openUnder(root) filters by prefix at
                       read time -- what the diagnostics feature re-opens
                       onto a rebuilt session
    scheduler.ts    -- makeScheduler: the debounced revalidate trigger.
                       Scheduler { schedule, settle }; schedule coalesces a
                       burst behind a fixed delay and never downgrades a
                       tier to "edit" once "full" is requested; a schedule
                       during a run queues exactly one more run; a burst
                       that never goes quiet for delay still runs at most
                       maxWait after the first schedule of an idle
                       scheduler (SchedulerOptions.maxWait). State lives in
                       one SynchronizedRef with a single writer at a time:
                       schedule's idle-or-pending transition and every
                       chain-side write (phase to running, the post-run
                       rerun-and-reset, the finalizer's reset-to-idle) all
                       go through the ref's own guarded modify/update, each
                       chain-side write gated on a fiber-identity check
                       against the entry it reads. schedule never awaits
                       Fiber.interrupt on the chain it replaces -- that
                       would wait on the superseded chain's finalizer,
                       which needs the very permit schedule is holding --
                       it forks the interrupt into the scheduler's scope
                       instead and returns
    registry.ts     -- makeSessionRegistry: workspace folders -> one
                       BundleSession per resolved bundle root, lazily, with
                       config discovery per folder. State is one Ref of
                       { folders: folder -> slot, roots: bundleRoot ->
                       entry }: a folder slot is Unbuilt, Building (a
                       Deferred concurrent callers await), Failed, or Live
                       (pointing at a root); a root entry holds the handle,
                       its scope and the set of folders resolving to it (the
                       refcount). Two folders resolving to one root (/repo
                       and /repo/okf) share one session; removing a folder
                       disposes the root entry only when its last folder
                       goes. SessionRegistryShape.rebuild(bundleRoot)
                       re-resolves every folder of that root once, builds
                       the fresh session(s), swaps them in, then disposes
                       exactly the entry the swap replaced (onDispose runs
                       once per session, never per folder); a folder whose
                       config now fails is recorded as Failed and retried
                       later like any other failed build. `sessions` lists
                       each root once. Lock order: every transition is one
                       synchronous Ref.modify, so nothing holds a lock
                       across I/O -- config resolution, BundleSession.make,
                       Scope.close and onDispose all run outside it, and a
                       first request for an unbuilt folder stalls only
                       callers for that same folder (they await its
                       Building Deferred). Folders keep pointing at the
                       outgoing session until the rebuild's swap, so a
                       sessionFor racing a rebuild finds a valid session,
                       never a miss
  features/
    documentSync.ts -- DocumentEvent, registerDocumentSync: the four
                       textDocument/did* notifications as events on
                       absolute paths; non-file URIs dropped
    diagnostics.ts  -- makeRevalidatePublisher(transport): builds a
                       DiagnosticsPublisher { publish, clear } --
                       `publish` is the RevalidatePublisher a
                       SessionRegistry's onRevalidate calls back into
                       (revalidate, then publishDiagnostics fan-out). Each
                       file's send-then-remember step runs inside
                       Effect.uninterruptible: the notification is sent
                       before the remembered-non-empty set is updated, and
                       an external interrupt (a rebuild's or dispose's
                       Scope.close, which awaits this chain fiber) cannot
                       land between the two -- otherwise a revalidate that
                       cleared a URI could be interrupted after updating
                       memory but before sending `[]`, and a later `clear`
                       would never re-send it. `clear(root)` publishes []
                       for every URI still remembered for `root` and
                       forgets it, and is what the registry's onDispose is
                       built from.
                       makeDiagnosticsFeature(registry): builds
                       DiagnosticsFeature { onDocumentEvent, onWatchedFiles
                       }, owning a session/documents.ts DocumentMemoryShape
                       so a config-change rebuild can carry every open
                       document's overlay into the fresh session before
                       scheduling its full revalidate. The publisher is
                       built before the registry and passed in as
                       onRevalidate, with `clear` composed into onDispose
                       -- no mutable box, since the publisher exists in
                       full before the registry needs either of its
                       members.
    locate.ts       -- position and identity helpers navigation.ts,
                       hover.ts and symbols.ts share (all @internal, not in
                       the barrel):
                       conceptAtPath (delegates to the engine's conceptFor),
                       offsetOf(text, position) (LSP position -> UTF-16
                       offset, the inverse of DiagnosticRange.fromOffset's
                       line/character mapping; a character past the end of
                       its line clamps to that line's end), edgeAt(graph,
                       bundleRelativePath, offset) (the outgoing edge whose
                       recorded position contains offset, ties broken by the
                       shorter span), definitionOf(bundle, conceptId) (see
                       Navigation below)
    navigation.ts   -- registerNavigation(transport, registry): textDocument/
                       documentLink, textDocument/definition,
                       textDocument/references (see Navigation below)
    hover.ts        -- registerHover(transport, registry): textDocument/hover;
                       renderHover (@internal, not in the barrel) is the
                       pure markdown renderer, tested directly (see Navigation below)
    symbols.ts      -- registerWorkspaceSymbols(transport, registry):
                       workspace/symbol across every live session (see
                       Navigation below)
    concepts.ts     -- registerConcepts(transport, registry) and
                       notifyBundleChanged(transport, root, reason): the
                       okfit/concepts request and okfit/bundleChanged
                       notification, okfit's own protocol extensions for an
                       editor's concept explorer (see Custom methods below)
    names.ts        -- OKFIT_COMMANDS, OKFIT_CODE_ACTION_KINDS: the command
                       ids and code action kinds server.ts advertises in
                       INITIALIZE_RESULT.capabilities, shared with the
                       features that implement them and copied into the VS
                       Code extension
    edits.ts        -- EditFailure, statusTextEdits, verifiedTextEdits,
                       humanActor, describeFailure: the edit machinery
                       actions.ts and commands.ts share -- TextEdits for a
                       concept's status or verified entry, and human-actor
                       resolution; also conceptSnapshot (@internal, not in
                       the barrel), the registry -> {concept, config,
                       projectRoot} lookup both draw on (see Code actions
                       below)
    actions.ts      -- registerCodeActions(transport, registry):
                       textDocument/codeAction (see Code actions below)
    commands.ts     -- registerCommands(transport, registry): workspace/
                       executeCommand, RevalidateResult (see Commands below)
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
  which rebuilds that session's bundle root instead -- once, however many
  workspace folders share it: the old session's
  diagnostics are cleared, every document still open under the new
  session's bundle root is re-opened onto it from `session/documents.ts`'s
  registry-wide memory, and a full revalidate is scheduled on it. A config
  that still fails to load after the rebuild is retried later exactly like
  any other failed build (`okf/limitations/no-config-reload-in-phase-3.md`,
  discharged by the phase 4 rebuild path above).
- **Dropped session.** Whenever a bundle root's session is disposed -- a
  config-change rebuild, or `removeFolders`/`setFolders` dropping the last
  workspace folder that resolves to it (dropping one of several folders
  sharing a root disposes nothing) -- the registry's `onDispose` runs once
  for that session, and `clear(root)`
  publishes `[]` for every URI that session had last published non-empty,
  then forgets it. A URI a normal publish already emptied (and so already
  dropped from the remembered set) does not get a second `[]` from a later
  dispose.
- A folder whose config failed to load is retried on `didOpen`,
  `didSave` (`sessionFor(path, { retryFailed: true })`) and on any
  watched-file change under it (`registry.retryFailed`, which schedules
  `full` on each folder that now builds). The failure is logged again
  only when its message differs from the last one logged for the folder.
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

## Navigation

`registerNavigation` (`src/features/navigation.ts`) wires
`textDocument/documentLink`, `textDocument/definition` and
`textDocument/references` onto the transport. Every handler runs on the
transport's own request fiber, never the notification queue: a request is
answered synchronously from whatever the owning session's last revalidate
produced, and never schedules or waits on one (decision 4 of the phase 4
plan). `registry.sessionFor(path)` then `session.bundle()`/`session.graph()`
gives that snapshot; a missing session, a bundle or graph that has never
loaded (before the first revalidate), a non-`file:` URI, or a path outside
every bundle root all answer `null`/`[]` -- never a hang.

- **`textDocument/documentLink`** answers every locatable edge out of the
  concept at the requested file: a `concept` or `file` target's `target` is
  the resolved absolute path's `file:` URI and `range` is the edge's own
  recorded position; a `missing` target is omitted entirely (there is
  nothing to link to). A raw body link whose URL is an actual URL (RFC 3986
  scheme or `://`) is never a graph edge at all -- `Graph.fromBundle` drops
  URL, self, external and descriptor links before building edges -- so
  `documentLinksOf` also walks `document.links` directly for those and
  reports the URL string itself as `target`.
- **`textDocument/definition`** finds the edge at the request position with
  `edgeAt` (`features/locate.ts`), then locates its target (decision 5): a
  `concept` target's definition is its first depth-1 heading's range, else
  its frontmatter block, else `0:0` (`definitionOf`); a `file` target's
  definition is that file's own `0:0`; a `missing` target, or no edge at the
  position at all, answers `null`.
- **`textDocument/references`** answers with one `Location` per predecessor
  edge into the concept the requested file itself is (not the position under
  the cursor) -- every edge in the graph whose `to` is that concept's id,
  each at its own recorded range in the referring file, **excluding a
  self-loop** (`edge.from === edge.to`): a concept whose own `resource` field
  happens to reference its own file is, by the graph's own construction, one
  of its own predecessor edges, but pointing a concept at itself is never a
  reference from somewhere else, so it is filtered rather than reported.
  `context.includeDeclaration` adds the concept's own definition location
  (`definitionOf`) to the result.
- **`textDocument/hover`** (`features/hover.ts`) answers one of three kinds
  (decision 6), each rendered by the pure `renderHover`: an edge at the
  position (`edgeAt`, body link or frontmatter path field) renders the
  target concept's title, type, status, trust tier (`Derive.trustTier`) and
  staleness (`Derive.staleness`, against a `now` read once per request with
  `DateTime.now`); the `type:` value (located with
  `DiagnosticRange.forFrontmatterPath(document, ["type"])`) renders that
  type's `description`/`guidance` from `session.config().types`; a top-level
  frontmatter key on its own line (`^key:`, no leading whitespace, inside the
  frontmatter block) renders that field's `description` from
  `session.config().types[type].fields[key]` -- located with a one-line
  regex bounded by the frontmatter block's own range, not a second
  `frontmatterPathRange`-style lookup, since that helper locates a value's
  span and the key itself has none. Anything else, or any of the above with
  nothing declared for it, answers `null`. `Hover.contents` is a
  `MarkupContent` with `kind: "markdown"`.
- **`workspace/symbol`** (`features/symbols.ts`) answers with one
  `SymbolInformation` per matching concept across **every live session**
  (`registry.sessions`, not just the requested file's session): `name` is
  the title (the id when there is no title), `containerName` is the type,
  `kind` is `SYMBOL_KIND_OBJECT`, `location` is `definitionOf`. The filter is
  a case-insensitive substring over id and title; an empty query matches
  every concept. Results are deduplicated by definition URI, not id (two
  bundles each with a `project` concept are two symbols), sorted by id then
  URI, and capped at 200.

Bundle-relative and absolute paths round-trip through `convert/uri.ts` only;
range conversion goes through `convert/range.ts`'s `toLspRange`/
`toLspLocation`, which re-map a `DiagnosticRange`'s end position through the
file text the same way `convert/diagnostic.ts`'s `toLspDiagnostic` does.

## Custom methods

`registerConcepts` (`src/features/concepts.ts`) wires `okfit/concepts` onto
the transport for the VS Code extension's concept explorer (LSP roadmap
phase 6); `notifyBundleChanged` (same file) sends `okfit/bundleChanged`. Both
are okfit protocol extensions, named with the `okfit/` prefix since the LSP
specification reserves `$/` for its own and leaves vendor prefixes to
implementations. `INITIALIZE_RESULT.capabilities.experimental` advertises
`{ okfitConcepts: true }` so a client can feature-detect.

- **`okfit/concepts`** first warms up: every current workspace folder
  (`registry.folders`) gets its session built via `registry.sessionFor` if it
  has never been resolved, and every live session (`registry.sessions`) whose
  `bundle()` is still `None` runs a first `full` revalidate through the
  normal scheduler path (`handle.scheduler.schedule("full")` then
  `.settle`), so a client that asks before any document is open still gets a
  populated result. Nothing warms up on its own -- a server nobody sends this
  request to (Claude Code, still lazy-by-default) builds no session it
  otherwise wouldn't have. It then answers from every live session's
  last-loaded bundle: one `BundleSummary` per session whose `bundle()` is
  `Some` (a session whose bundle still never loaded -- no config, or one that
  failed -- contributes no entry), each carrying `root`, `rootUri`,
  the resolved `profile` name (`session.config().bundle?.profile`, with the
  documented `"none"` sentinel -- profile merging disabled -- mapped to
  `undefined`; `OkfitConfig.DEFAULTS.bundle.profile` is always
  `"software-project"`, so an unset `profile` key never itself yields
  `undefined`), and one `ConceptSummary` per concept with a definition
  location (`definitionOf`, `features/locate.ts` -- same exclusion as
  `workspace/symbol`). A concept's `status` is its raw frontmatter value,
  `undefined` when absent (not `Derive.status`'s `"stable"` default); `stale`
  is `Derive.isStale` against `now` read once per request. Concepts are
  sorted by type, then title, then id; bundles by root.
- **`okfit/bundleChanged`** is sent from the registry's own `onRevalidate` and
  `onDispose` callbacks (`server.ts`), after `publisher.publish`/`.clear`
  respectively -- never from `features/diagnostics.ts` itself -- so a client
  that re-fetches `okfit/concepts` on this notification always sees the
  diagnostics the matching publish already sent. `reason` is `"revalidated"`
  for a completed revalidate (regardless of whether anything was actually
  republished) and `"dropped"` for a disposed session (a config-change
  rebuild, or the last workspace folder resolving to that root going away).

## Code actions

`registerCodeActions` (`src/features/actions.ts`) wires `textDocument/
codeAction` onto the transport, answering from the requested file's owning
session's last-loaded concept -- a missing session, an unloaded bundle, a
non-`file:` URI, or a path outside every bundle root all answer `[]`, never
a hang, same posture as hover and navigation. Every edit it offers is
computed by `src/features/edits.ts`, the module `src/features/commands.ts`
(Commands below) also shares:

- `conceptSnapshot(registry, path)` (`@internal`, not in the barrel) mirrors
  `hover.ts`'s `snapshotFor`, but answers `{ concept, config, projectRoot }`
  for the concept at `path` rather than hover's bundle/graph pair;
  `projectRoot` is `handle.folder` -- the workspace folder whose config
  resolution built the owning session -- never `bundleRoot` (V-7's
  `generatedBy` cwd).
- `statusTextEdits(registry, path, status)` and `verifiedTextEdits(registry,
  path, now)` wrap `@okfit/engine`'s `FrontmatterEdits.status`/`.verified`:
  each `MarkdownEdit`'s whole-file offset into `concept.document.source` is
  converted to an LSP range with `DiagnosticRange.fromOffset` then
  `toLspRange`, against that same `source` -- no BOM adjustment, because a
  file whose bytes open with a BOM never decodes as a concept at all
  (`frontmatter-missing`, since core never strips one before scanning for
  the opening fence): `document.source` can therefore never itself carry a
  leading BOM, and every offset `FrontmatterEdits` returns already lines up
  with it directly (`__test__/features/actions.test.ts`'s BOM case proves
  this rather than a BOM-adjusted offset). `verifiedTextEdits` fails
  `DraftCannotBeVerified` for a draft concept and `AlreadyVerified` when the
  resolved actor already carries a `verified` entry; both wrap
  `Derivation.generatedBy({ writer: "human", cwd: projectRoot, config })`
  and fail `ActorUnresolved` when it does.
- `humanActor(registry, path)` resolves the same actor
  `verifiedTextEdits` would, answering `Option.none()` instead of failing --
  a code action's title needs to know whether a human actor resolves at all
  before it can decide whether to offer `Mark verified`. Only
  `generatedBy`'s typed `GeneratedByError` channel maps to `Option.none()`
  (`Effect.result`, not `Effect.catchCause`): a defect (a git subprocess
  crash) or an interrupt still propagates rather than being read as "no
  actor". A resolution failure is logged once per project root, at
  `logDebug`, never to stdout (a module-level `Set` tracks which roots have
  already logged).
- `describeFailure(failure)` renders any `EditFailure` as a short message,
  what `commands.ts`'s `okfit.setStatus`/`okfit.markVerified` handlers surface
  as an `LspError`'s message when an edit could not be computed;
  `registerCodeActions` itself never surfaces one -- a failed edit just means
  that action is omitted (`Effect.option` around every
  `statusTextEdits`/`verifiedTextEdits` call).

`registerCodeActions` offers one `Set status: <status>` action (kind
`okfit.status`) per `Status` literal the concept is not already in, in
`Status`'s own literal order (`draft`, `stable`, `deprecated` --
`Derive.status`'s `"stable"` default when the frontmatter key is absent
counts as the concept's status here), and one `Mark verified by <actor>`
action (kind `okfit.verify`) when `humanActor` resolves and
`verifiedTextEdits` succeeds. When `params.context.diagnostics` carries a
`status-missing` diagnostic (`code === "status-missing"` and, when the
diagnostic carries `data`, `data.source === "core.lint"` --
`convert/diagnostic.ts`'s own shape), every status action is promoted to
kind `quickfix`, carries that diagnostic in its own `diagnostics`, and the
`draft` action alone is `isPreferred`. `registerCodeActions` requires `Git`
in its own `R` (`Derivation.generatedBy`'s requirement); it captures its
context once, the same pattern `session/registry.ts` uses, so the handler
passed to `transport.onRequest` itself needs none.

## Commands

`registerCommands` (`src/features/commands.ts`) wires `workspace/
executeCommand` onto the transport for the three ids `features/names.ts`'s
`OKFIT_COMMANDS` advertises. Like `registerCodeActions`, it requires `Git` in
its own `R` and captures its context once, so the handler passed to
`transport.onRequest` itself needs none. Each command's `arguments` (an
`ExecuteCommandParams.arguments` array, positional by index) is decoded
through a small `Schema.Tuple`; a decode failure fails with an `LspError`
naming the expected shape (`-32602`), and an unrecognized command id fails
naming it (`-32601`).

- **`okfit.setStatus`** -- args `[uri, status]`
  (`Schema.Tuple([Schema.String, Status])`). Computes `statusTextEdits`,
  sends it to the client with `transport.sendRequest<ApplyWorkspaceEditParams,
  ApplyWorkspaceEditResult>("workspace/applyEdit", { label, edit })`, and
  answers the client's own `ApplyWorkspaceEditResult` verbatim -- a `{
  applied: false, failureReason }` the client returns is not an `LspError`,
  only a transport failure of that request is (`sendRequest`'s own
  contract). An `EditFailure` from `statusTextEdits` fails as an `LspError`
  whose message is `describeFailure(failure)`, under `-32803` ("request
  failed").
- **`okfit.markVerified`** -- args `[uri]` (`Schema.Tuple([Schema.String])`).
  Same `workspace/applyEdit` round trip, over `verifiedTextEdits(registry,
  path, now)` (`now` read once per request with `DateTime.now`, the same
  posture as `registerCodeActions`).
- **`okfit.revalidate`** -- args `[rootUri?]`, an optional single-string
  tuple (`Schema.Tuple([Schema.optionalKey(Schema.String)])`) so the client
  may send `[]` or omit `arguments` entirely. `rootUri` present: schedules a
  `full` revalidate (`handle.scheduler.schedule("full")` then `.settle`, the
  same warm-up path `okfit/concepts` uses) on the one live session whose
  `handle.bundleRoot` matches it (`uriToPath`), or none when no session
  matches. `rootUri` absent: every live session (`registry.sessions`).
  Answers `{ roots }`, the revalidated sessions' `bundleRoot`s as `file:`
  URIs (`pathToUri`) -- `{ roots: [] }` for an unmatched `rootUri` or no live
  sessions. A revalidate that changes nothing in a session's diagnostic set
  still fires `okfit/bundleChanged` (`reason: "revalidated"`, same rule as
  every other revalidate) even though no `textDocument/publishDiagnostics`
  follows it, since `onRevalidate`'s publish step only republishes a file
  whose set actually changed.

`registerCommands` is registered on `transport` after `registerCodeActions`
in `server.ts`.

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

**Input end and the drain.** `vscode-jsonrpc` decodes and dispatches
buffered frames asynchronously, so the input's `end` can arrive before the
messages it delivered are dispatched. The library's reader therefore reads a
transport-owned `PassThrough`: the input is piped into it with
`{ end: false }`, and on the input's first `end` or `close` the transport
writes one frame of the reserved notification `okfit/$inputEnded`, then
ends it. The reader's decode queue and the connection's message queue are
both FIFO, so that notification is dispatched after every earlier message;
an `exit` among them has already resolved `listen` with `"exit"`. Its
handler waits for the handler `FiberSet` to empty, then for every earlier
message's processing to settle (tracked through the connection's
`messageStrategy`, which covers a request's response write) and for the
transport-owned writer's outstanding writes, bounded by
`WRITE_SETTLE_TIMEOUT` (2 s default), and resolves `"closed"`. `exit` itself
does not wait: with the library's default unlimited parallelism the queue
dispatches `exit` without waiting for an earlier `shutdown`'s reply, so a
client that does not wait for that reply may not get it. The sentinel's
params carry a token minted per transport, so a client sending
`okfit/$inputEnded` itself is ignored. An input that ends in the middle of a
frame swallows the sentinel into that frame, so `SENTINEL_FALLBACK_TIMEOUT`
(2 s default) after the input ends the same drain runs without it; the
sentinel's arrival cancels the fallback. Both bounds are injectable through
`ReferenceTransportOptions.drain` (`{ fallback, writeSettle }`); `main.ts`
passes nothing, so both stay at their defaults, and the truncated-frame case
in `__test__/protocol/reference.test.ts` passes a short `fallback` so the
suite does not wait out the production bound. The
`PassThrough` is built with `emitClose: false`, so the reader never marks the
connection Closed and a drained handler can still send; the scope finalizer
interrupts a running drain, unpipes the input, ends the `PassThrough` and
disposes the connection. The reader's partial-message timer is disabled
(`partialMessageTimeout = 0`): on a truncated frame it re-arms forever and
survives `dispose`, keeping the event loop alive. Covered by the one-chunk,
truncated-frame and spoofed-sentinel cases in
`__test__/protocol/reference.test.ts`.

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
  the authority on a clean shutdown; `"closed"` means the input ended with
  no `exit` among the messages it delivered.
- **`main.ts`'s program calls `process.stdin.unref()` once `listen` has
  resolved; the success branch of its `teardown` then hands the mapped
  exit code to the `onExit` callback `NodeRuntime.runMain`'s runner
  provides and calls `process.exit(code)` itself.** That callback
  (`@effect/platform-node-shared`'s `NodeRuntime.js`) only calls
  `process.exit` when the code is non-zero or a signal was received; for a
  code-`0` success it relies on Node's event loop draining. Two handles
  prevent that: `process.stdin`, once read, stays open after a clean
  `shutdown` + `exit` (the LSP contract: the server terminates itself on
  `exit`, the client never has to close the pipe first), and, when the
  client passes `--clientProcessId`, the library's node entry installs a
  never-unref'd liveness interval at module load that nothing in this
  package can clear. The explicit exit covers both; covered by the
  `--clientProcessId` case in `__test__/e2e/server.e2e.test.ts`. Unlike
  the MCP server, this one still distinguishes a clean disconnect (`0`)
  from `exit` without `shutdown` (`1`): `onExit` gets the program's own
  mapped code, never a hardcoded `0`. The interrupts-only branch calls
  `onExit(0)` directly, same as MCP.
- **`process.exit` does not flush.** Writes to `process.stdout` and
  `process.stderr` are asynchronous when they are pipes on macOS, and
  `process.exit` discards any still pending. Anything the client must
  receive has to be written before `listen` resolves: the `"closed"`
  drain waits for the transport's outstanding writes (bounded by
  `WRITE_SETTLE_TIMEOUT`), but `exit` resolves at once, so a response or
  log line still in flight at `exit` can be lost.
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
  barrel export; an implementation helper shared across files but kept out
  of the barrel is `@internal`. Tab indentation.
- Commits are conventional, DCO signed, and never on `main`.
