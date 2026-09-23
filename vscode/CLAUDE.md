# @okfit/vscode-extension

The `okfit` VS Code extension. Ships a language client for `@okfit/lsp`
plus (in later tasks) a tree view and commands, bundled by `tsdown` into
two ESM entries: `dist/extension.js` (the extension host process) and
`dist/server.js` (the language server, bundled standalone so the `.vsix`
ships no `node_modules`).

## Layout

```text
src/
  extension.ts        -- the extension host entry: activate/deactivate,
                          built with reactive-vscode
server/
  main.ts              -- the bundled language server entry: calls
                           @okfit/lsp/main's main() with a Distribution
lib/
  package-vsix.ts       -- runs `vsce package` against a copy of package.json
                            whose name is rewritten to the Marketplace name
                            "okfit" (the workspace name stays
                            @okfit/vscode-extension for pnpm and changesets)
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
- The `package` script (`lib/package-vsix.ts`) is the only place the
  Marketplace name `okfit` is written; `vsce publish --packagePath` reads
  the name from inside an already-built `.vsix`, so the rewrite never
  needs to run twice for one artifact.
- `.vscodeignore` is allow-list form: everything is excluded unless
  explicitly named. Adding a new bundle entry or asset means adding a line
  here too.
- Relative imports use `.js` extensions; built-ins use `node:`.
- Commits are conventional, DCO signed, and never on `main`.
