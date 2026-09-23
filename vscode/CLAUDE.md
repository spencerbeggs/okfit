# @okfit/vscode-extension

The `okfit` VS Code extension. Ships a language client for `@okfit/lsp`
plus (in later tasks) a tree view and commands, bundled by `tsdown` into
two ESM entries: `dist/extension.js` (the extension host process) and
`dist/server.js` (the language server, bundled standalone so the `.vsix`
ships no `node_modules`).

## Layout

```text
src/
  extension.ts         -- the extension host entry: activate/deactivate,
                           built with reactive-vscode
  client.ts             -- startClient: resolves and starts the language
                            client over stdio
  resolve-server.ts      -- resolveServer: the pure, three-step server
                            resolution (setting, workspace, bundled)
  config.ts              -- the reactive-vscode defineConfiguration proxy
                            over the okfit.* settings
  status.ts              -- statusFor: pure function to the Language
                            Status item's text, detail and severity
  commands.ts             -- registerCommands: okfit.validateBundle,
                            okfit.openConcept
  serial-queue.ts         -- createSerialQueue: serializes client restarts
  tree/
    model.ts              -- tree node shapes for the OKF Concepts view
    provider.ts            -- ConceptsProvider: a TreeDataProvider fed by
                            okfit/concepts, refreshed on okfit/bundleChanged
    decorations.ts          -- ConceptDecorations: status and stale badges
    wire.ts                 -- the okfit/concepts wire types, mirroring
                            @okfit/lsp's ConceptsResult without importing it
server/
  main.ts              -- the bundled language server entry: calls
                           @okfit/lsp/main's main() with a Distribution
lib/
  package-vsix.ts       -- runs `vsce package` against a copy of package.json
                            whose name is rewritten to the Marketplace name
                            "okfit" (the workspace name stays
                            @okfit/vscode-extension for pnpm and changesets)
  assert-version.sh      -- asserts a release tag's version matches
                            package.json's version before packaging
```

The Layout tree above is a map, not a substitute for reading source: it
names files and their headline exports, not every symbol. Later tasks
extend this tree; read the file before assuming its export list from this
tree alone.

Tests live in `__test__/`, never in `src/`; see `__test__/CLAUDE.md`.

## Rules

- Everything in `devDependencies`, nothing in `dependencies`, on purpose:
  both bundle entries are self-contained, so `vsce` must never pack a
  `node_modules` dependency.
- `build:dev` exists only so Turbo's `^build:dev` edge builds this
  member's `dist/` in the same graph as the packages it depends on.
- `src/tree/model.ts`, `src/status.ts` and `src/resolve-server.ts` never
  import `vscode`: each is a pure function tested without the extension
  host (`resolveServer`'s inputs are already plain strings and a callback,
  `statusFor` takes plain data in and returns plain data out, and the tree
  model is data shapes only). A file that needs the `vscode` API belongs
  next to these, not inside them.
- Everything the extension needs at runtime is bundled; nothing is read
  from `node_modules` at activation. `vsce package` is always run
  `--no-dependencies` (`lib/package-vsix.ts:13`) -- both `dist/extension.js`
  and `dist/server.js` are self-contained `tsdown` bundles, so a
  `node_modules` dependency packed alongside them would be dead weight at
  best and a version-skew bug at worst.
- The `package` script (`lib/package-vsix.ts`) is the only place the
  Marketplace name `okfit` is written; `vsce publish --packagePath` reads
  the name from inside an already-built `.vsix`, so the rewrite never
  needs to run twice for one artifact.
- `.vscodeignore` is allow-list form: everything is excluded unless
  explicitly named. Adding a new bundle entry or asset means adding a line
  here too.
- The workspace root's `pnpm-workspace.yaml` disables the postinstall
  scripts of `@vscode/vsce-sign` and `keytar` under `allowBuilds`
  (`pnpm-workspace.yaml:6-8`) -- the repository's YAML formatter strips
  standalone comments from that file, so the rationale lives here instead:
  `vsce publish` only invokes its signing postinstall when `--sign-tool`
  is passed, which the `VS Code Marketplace` workflow never does; `keytar`
  is an optional credential-store dependency of `vsce` this repository
  never uses (publishing runs through Azure workload identity federation
  or a `VSCE_PAT` secret, never an interactive credential store).
- Relative imports use `.js` extensions; built-ins use `node:`.
- Commits are conventional, DCO signed, and never on `main`.

## Commands

```bash
pnpm --filter @okfit/vscode-extension build     # tsdown: dist/extension.js, dist/server.js
pnpm --filter @okfit/vscode-extension package   # vsce package --no-dependencies -> okfit.vsix
pnpm --filter @okfit/vscode-extension types:check
```

The F5 debug path (launching the "Run okfit extension" configuration) and
the packaged-build smoke test are in `README.md`.

See [VS Code Extension](../okf/modules/vscode-extension.md) for the full
Module concept: server resolution, views and commands, and the
publishing Runbook.
