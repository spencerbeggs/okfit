# @okfit/engine

The okfit engine: the platform layer, config discovery, and the
validate/verify/sync/init/context programs shared by `@okfit/cli` and
`@okfit/mcp`, plus the JSON envelope contracts both front ends render.
Neither front end duplicates this logic; `@okfit/cli` renders it as a
human/JSON CLI, `@okfit/mcp` serves it as MCP tools, and `@okfit/mcp`
depends on this package directly rather than on `@okfit/cli` -- see
`okf/decisions/engine-front-end-split.md` for why.

## Layout

```text
src/
  platform.ts           -- OKFIT_APP_NAMESPACE, OkfitPlatform: the one XDG/Node
                            platform layer both front ends provide
  errors.ts              -- ConfigPathNotFoundError, InitOverwriteError, ConfigMalformedError,
                             VerifyConceptNotFoundError, VerifyUnsupportedFrontmatterError
  config/
    anchor.ts             -- resolveProjectRoot, resolveBundleRoot (pure)
    layer.ts              -- buildConfigLayer, provideConfig (the K-1 stat-before-layer)
    resolve.ts             -- resolveProjectConfig, DEFAULT_PROFILE_NAME
  context/
    run.ts                 -- runContext: index.md stat only, never Bundle.load
  validate/
    run.ts                 -- Now (Context.Service), RunOptions, RunResult, run
  verify/
    locate.ts               -- Located, locate, stripBom, documentNewline (pure)
    splice.ts                -- SpliceTarget, VerifyEntry, splice (pure, never a YAML serialiser)
    run.ts                    -- VerifyOptions, VerifyResult, runVerify: loads the bundle,
                                  resolves the actor, splices, and writes atomically
  sync/
    generated.ts              -- locateGenerated, GeneratedLocated, spliceGenerated
    index.ts                   -- syncIndex
    log.ts                      -- mergeLog, syncLog
    write.ts                     -- writeAtomic
    run.ts                        -- SkipReason, SyncMode/Options/Result, runSync
  init/
    scaffold.ts                   -- CONFIG_RELATIVE_PATH, ScaffoldOptions, ScaffoldFile,
                                      configValue, targetPaths, files (pure/Effect-typed, no process)
  render/
    context.ts                     -- ContextEnvelope/ContextType/ContextTag, contextEnvelope (envelope half)
    verify.ts                       -- VerifyEnvelope, verifyEnvelope (envelope half)
    sort.ts                          -- RenderedDiagnostic, DiagnosticSource, collect, sort (pure)
    json.ts                           -- JsonDiagnostic/Envelope/ErrorEnvelope/Summary, json, jsonError (pure)
    exit.ts                           -- Tally, tally, forDiagnostics (pure)
    sync.ts                            -- SyncEnvelope, SyncModeEnvelope, syncEnvelope (envelope half)
  index.ts                            -- public barrel; this is what @okfit/cli and @okfit/mcp import
```

The Layout tree above is a map, not a substitute for reading source: it
names files and their headline exports, not every symbol. Read the file
before assuming its export list from this tree alone.

Tests live in `__test__/`, never in `src/`; see `__test__/CLAUDE.md`.

## Rules

- Effect v4 only, at the version in `catalog:effect`. Consult
  `.repos/effect/packages/effect/src` for what v4 exports; `node_modules`
  wins on disagreement.
- **Process boundary, enforced by `__test__/boundaries.test.ts` -- with NO
  allowlist.** No file under `src/` reads `process`, anywhere, ever; there
  is no per-file exception the way `@okfit/cli`'s narrower rule carries
  one. This package is a library both a CLI and an MCP server import: a
  `process` read here would be a runtime environment read baked into
  whichever front end imports it first, defeating the point of sharing the
  code. The boundary test was probed against a deliberate violation to
  confirm it genuinely fails, not just that it passes on the current tree.
- **Dependency closure (K-35).** `package.json`'s `dependencies` block is
  the full runtime closure this package's own code, plus core's and
  profiles' peers, needs: `@okfit/core`'s peers (`effect`,
  `@effected/config-file`, `@effected/glob`, `@effected/jsonc`,
  `@effected/markdown`, `@effected/toml`, `@effected/walker`,
  `@effected/yaml`), `@okfit/profiles`'s peers (`@effected/git`,
  `@effected/markdown`, `@okfit/core`), and the engine's own wiring
  (`@effected/app`, `@effected/xdg`, `@effected/store`,
  `@effect/platform-node`). Several of these are never imported directly by
  a file under `src/` -- they satisfy a peer of a dependency this package
  DOES import directly. Do not "clean up" an apparently-unused entry:
  removing one breaks whichever dependency declared it as a peer, at
  install time, not at a lint pass that can catch it.
- **The XDG namespace literal exists exactly once.** `OKFIT_APP_NAMESPACE`
  in `platform.ts` is the only place the `"okfit"` application namespace is
  spelled out; both `@okfit/cli` and `@okfit/mcp` provide `OkfitPlatform`
  wholesale rather than rebuilding an `AppDirs.layer` call of their own, so
  the two front ends resolve the same user config directory structurally,
  not by two copies agreeing.
- Tests live in `__test__/`, never in `src/`.
- Relative imports use `.js` extensions; built-ins use `node:`. Type imports
  are separate `import type` statements. TSDoc `@public` on every `src/`
  export. Tab indentation.
- `savvy.build.ts` keeps two `ae-forgotten-export` suppressions: `_base`,
  for the inline `Schema.TaggedError` classes (`errors.ts`), and `"Now"`,
  because `validate/run.ts`'s `Now` (`@internal`, not in the barrel) still
  appears in inferred requirements at every call site that reads it. Both
  are load-bearing here -- `dist/prod/issues.json`'s `suppressed` array is
  non-empty, unlike `@okfit/cli`'s copy of the same two rules, which now
  match nothing since both symbols live here.
- Commits are conventional, DCO signed, and never on `main`.
